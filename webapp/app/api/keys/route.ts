import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { randomBytes, createHash } from "crypto";
import { requireSubscribedUser, readJsonObject } from "@/lib/api-auth";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// GET /api/keys — list user's API keys
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(keys);
}

// POST /api/keys — create a new API key
export async function POST(request: Request) {
  // Les clés API donnent accès au serveur MCP : réservé aux abonnés
  const guard = await requireSubscribedUser();
  if (guard.response) return guard.response;
  const userId = guard.userId;

  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: "Name is required (max 100 chars)" },
      { status: 400 }
    );
  }

  // Limit to 10 API keys per user
  const count = await prisma.apiKey.count({
    where: { userId },
  });
  if (count >= 10) {
    return NextResponse.json(
      { error: "Maximum 10 API keys per user" },
      { status: 400 }
    );
  }

  // Generate key: afk_ + 48 random hex chars
  const rawKey = "afk_" + randomBytes(24).toString("hex");
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  const apiKey = await prisma.apiKey.create({
    data: {
      userId,
      name,
      keyHash,
      keyPrefix,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
    },
  });

  // Return the full key ONLY on creation
  return NextResponse.json({ ...apiKey, key: rawKey }, { status: 201 });
}
