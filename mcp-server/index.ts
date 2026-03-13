/**
 * AI Friendly — MCP Server
 *
 * Streamable HTTP MCP server protected by API key authentication.
 * Provides tools to:
 *   - List user's registered sites
 *   - Run AI readability analysis, availability check, or security scan
 *   - Retrieve the latest results for any test type
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Analysis functions — imported from shared lib
// In Docker, these are copied to /app/lib/
import { analyzeUrl } from "./lib/analyzer.js";
import { checkAvailability } from "./lib/availability-checker.js";
import { scanSecurity } from "./lib/security-scanner.js";

const prisma = new PrismaClient();
const PORT = parseInt(process.env.MCP_PORT || "3001", 10);

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Authenticate a request via Bearer token.
 * Returns the userId if valid, null otherwise.
 */
async function authenticateRequest(
  req: express.Request
): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const apiKey = authHeader.slice(7);
  if (!apiKey || !apiKey.startsWith("afk_")) return null;

  const keyHash = hashKey(apiKey);
  const record = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!record) return null;

  // Update last used timestamp (fire and forget)
  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return record.userId;
}

/**
 * Create a configured McpServer with all tools registered,
 * scoped to the given userId.
 */
function createMcpServerForUser(userId: string): McpServer {
  const server = new McpServer({
    name: "aifriendly",
    version: "1.0.0",
  });

  // ── Tool: list_sites ──────────────────────────────────────────────────────
  server.registerTool(
    "list_sites",
    {
      title: "List Sites",
      description:
        "List all your registered sites with their latest scores. Returns site IDs needed for other tools.",
      inputSchema: z.object({}),
    },
    async () => {
      const sites = await prisma.site.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          url: true,
          isActive: true,
          availabilityEnabled: true,
          securityEnabled: true,
          createdAt: true,
          analyses: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { score: true, createdAt: true },
          },
          availabilityChecks: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { score: true, createdAt: true },
          },
          securityScans: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { score: true, createdAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const result = sites.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        isActive: s.isActive,
        availabilityEnabled: s.availabilityEnabled,
        securityEnabled: s.securityEnabled,
        latestAiScore: s.analyses[0]?.score ?? null,
        latestAiDate: s.analyses[0]?.createdAt ?? null,
        latestAvailabilityScore: s.availabilityChecks[0]?.score ?? null,
        latestAvailabilityDate: s.availabilityChecks[0]?.createdAt ?? null,
        latestSecurityScore: s.securityScans[0]?.score ?? null,
        latestSecurityDate: s.securityScans[0]?.createdAt ?? null,
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Tool: run_ai_analysis ─────────────────────────────────────────────────
  server.registerTool(
    "run_ai_analysis",
    {
      title: "Run AI Readability Analysis",
      description:
        "Run an AI readability analysis on a site. If site_id is provided, the result is saved to the database. If only url is provided, a one-off analysis is performed without saving.",
      inputSchema: z.object({
        site_id: z
          .string()
          .optional()
          .describe("ID of a registered site (from list_sites)"),
        url: z
          .string()
          .optional()
          .describe("URL to analyze (used if site_id is not provided)"),
      }),
    },
    async ({ site_id, url }) => {
      let targetUrl = url;

      // If site_id provided, look up the site
      if (site_id) {
        const site = await prisma.site.findFirst({
          where: { id: site_id, userId },
        });
        if (!site) {
          return {
            content: [
              { type: "text" as const, text: "Error: Site not found or not owned by you." },
            ],
            isError: true,
          };
        }
        targetUrl = site.url;
      }

      if (!targetUrl) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Provide either site_id or url.",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await analyzeUrl(targetUrl);

        // Save to DB if site_id was provided
        if (site_id) {
          await prisma.analysisResult.create({
            data: {
              siteId: site_id,
              score: result.score,
              maxScore: result.maxScore,
              details: JSON.parse(JSON.stringify(result)),
            },
          });
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error running analysis: ${msg}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Tool: run_availability_check ──────────────────────────────────────────
  server.registerTool(
    "run_availability_check",
    {
      title: "Run Availability Check",
      description:
        "Check site availability (HTTP status, ping, load time, SSL). If site_id is provided, saves the result.",
      inputSchema: z.object({
        site_id: z
          .string()
          .optional()
          .describe("ID of a registered site (from list_sites)"),
        url: z
          .string()
          .optional()
          .describe("URL to check (used if site_id is not provided)"),
      }),
    },
    async ({ site_id, url }) => {
      let targetUrl = url;

      if (site_id) {
        const site = await prisma.site.findFirst({
          where: { id: site_id, userId },
        });
        if (!site) {
          return {
            content: [
              { type: "text" as const, text: "Error: Site not found or not owned by you." },
            ],
            isError: true,
          };
        }
        targetUrl = site.url;
      }

      if (!targetUrl) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Provide either site_id or url.",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await checkAvailability(targetUrl);

        if (site_id) {
          await prisma.availabilityCheck.create({
            data: {
              siteId: site_id,
              score: result.score,
              httpStatus: result.httpStatus,
              pingMs: result.pingMs,
              ttfbMs: result.ttfbMs,
              loadTimeMs: result.loadTimeMs,
              responseSize: result.responseSize,
              sslValid: result.sslValid,
              sslExpiry: result.sslExpiry ? new Date(result.sslExpiry) : null,
              details: JSON.parse(JSON.stringify(result.details)),
            },
          });
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running availability check: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Tool: run_security_scan ───────────────────────────────────────────────
  server.registerTool(
    "run_security_scan",
    {
      title: "Run Security Scan",
      description:
        "Run an OWASP-based security scan (headers, SSL, cookies, info leaks, injection). If site_id is provided, saves the result.",
      inputSchema: z.object({
        site_id: z
          .string()
          .optional()
          .describe("ID of a registered site (from list_sites)"),
        url: z
          .string()
          .optional()
          .describe("URL to scan (used if site_id is not provided)"),
      }),
    },
    async ({ site_id, url }) => {
      let targetUrl = url;

      if (site_id) {
        const site = await prisma.site.findFirst({
          where: { id: site_id, userId },
        });
        if (!site) {
          return {
            content: [
              { type: "text" as const, text: "Error: Site not found or not owned by you." },
            ],
            isError: true,
          };
        }
        targetUrl = site.url;
      }

      if (!targetUrl) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Provide either site_id or url.",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await scanSecurity(targetUrl);

        if (site_id) {
          await prisma.securityScan.create({
            data: {
              siteId: site_id,
              score: result.score,
              headersScore: result.headersScore,
              sslScore: result.sslScore,
              cookiesScore: result.cookiesScore,
              infoLeakScore: result.infoLeakScore,
              injectionScore: result.injectionScore,
              details: JSON.parse(JSON.stringify(result.details)),
            },
          });
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running security scan: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Tool: get_latest_results ──────────────────────────────────────────────
  server.registerTool(
    "get_latest_results",
    {
      title: "Get Latest Results",
      description:
        "Get the latest analysis results for a registered site. Specify which test type(s) to retrieve.",
      inputSchema: z.object({
        site_id: z.string().describe("ID of a registered site (from list_sites)"),
        type: z
          .enum(["ai", "availability", "security", "all"])
          .default("all")
          .describe("Type of result to retrieve: ai, availability, security, or all"),
      }),
    },
    async ({ site_id, type }) => {
      const site = await prisma.site.findFirst({
        where: { id: site_id, userId },
        select: { id: true, name: true, url: true },
      });

      if (!site) {
        return {
          content: [
            { type: "text" as const, text: "Error: Site not found or not owned by you." },
          ],
          isError: true,
        };
      }

      const result: Record<string, unknown> = {
        site: { id: site.id, name: site.name, url: site.url },
      };

      if (type === "ai" || type === "all") {
        const latest = await prisma.analysisResult.findFirst({
          where: { siteId: site_id },
          orderBy: { createdAt: "desc" },
        });
        result.aiAnalysis = latest
          ? {
              score: latest.score,
              maxScore: latest.maxScore,
              details: latest.details,
              createdAt: latest.createdAt,
            }
          : null;
      }

      if (type === "availability" || type === "all") {
        const latest = await prisma.availabilityCheck.findFirst({
          where: { siteId: site_id },
          orderBy: { createdAt: "desc" },
        });
        result.availability = latest
          ? {
              score: latest.score,
              httpStatus: latest.httpStatus,
              pingMs: latest.pingMs,
              ttfbMs: latest.ttfbMs,
              loadTimeMs: latest.loadTimeMs,
              responseSize: latest.responseSize,
              sslValid: latest.sslValid,
              details: latest.details,
              createdAt: latest.createdAt,
            }
          : null;
      }

      if (type === "security" || type === "all") {
        const latest = await prisma.securityScan.findFirst({
          where: { siteId: site_id },
          orderBy: { createdAt: "desc" },
        });
        result.security = latest
          ? {
              score: latest.score,
              headersScore: latest.headersScore,
              sslScore: latest.sslScore,
              cookiesScore: latest.cookiesScore,
              infoLeakScore: latest.infoLeakScore,
              injectionScore: latest.injectionScore,
              details: latest.details,
              createdAt: latest.createdAt,
            }
          : null;
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  return server;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Server
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "aifriendly-mcp" });
});

// MCP endpoint — stateless (one server per request)
app.post("/mcp", async (req, res) => {
  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Invalid or missing API key" },
      id: null,
    });
    return;
  }

  try {
    const server = createMcpServerForUser(userId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Handle GET for SSE (required by some MCP clients)
app.get("/mcp", async (req, res) => {
  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Invalid or missing API key" },
      id: null,
    });
    return;
  }
  // Stateless server doesn't support GET SSE
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "This server operates in stateless mode. Use POST /mcp.",
    },
    id: null,
  });
});

// Handle DELETE for session cleanup
app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "This server operates in stateless mode. No sessions to delete.",
    },
    id: null,
  });
});

// Health check endpoint
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (error) {
    console.error("[HEALTH] Database connection failed:", error);
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// Global error handlers
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI Friendly MCP Server running on port ${PORT}`);
  console.log("Waiting for connections...");
});
