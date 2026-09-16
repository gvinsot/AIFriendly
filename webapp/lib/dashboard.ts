import { prisma } from "@/lib/prisma";

// The worker stores one availability check per site every minute (~86k rows per
// site over the 60-day retention), so dashboard data is reduced in SQL rather than
// loaded through Prisma. Nested `include: { take: 1 }` is avoided too: with several
// parent sites Prisma fetches every related row and paginates in memory.

type LatestRow = { siteId: string; id: string; score: number; createdAt: Date };

type LatestAvailabilityRow = LatestRow & {
  httpStatus: number | null;
  pingMs: number | null;
  loadTimeMs: number | null;
};

type LatestSecurityRow = LatestRow & {
  headersScore: number;
  sslScore: number;
  cookiesScore: number;
  infoLeakScore: number;
  injectionScore: number;
};

function bySiteId<T extends LatestRow>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.siteId, r]));
}

/** Per-site summary with the latest AI, availability and security scores. */
export async function getSiteSummaries(userId: string) {
  const [sites, latestAi, latestAvailability, latestSecurity] = await Promise.all([
    prisma.site.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, url: true, isActive: true },
    }),
    prisma.$queryRaw<LatestRow[]>`
      SELECT r.* FROM "Site" s
      CROSS JOIN LATERAL (
        SELECT "siteId", id, score, "createdAt" FROM "AnalysisResult"
        WHERE "siteId" = s.id ORDER BY "createdAt" DESC LIMIT 1
      ) r
      WHERE s."userId" = ${userId}`,
    prisma.$queryRaw<LatestAvailabilityRow[]>`
      SELECT r.* FROM "Site" s
      CROSS JOIN LATERAL (
        SELECT "siteId", id, score, "httpStatus", "pingMs", "loadTimeMs", "createdAt" FROM "AvailabilityCheck"
        WHERE "siteId" = s.id ORDER BY "createdAt" DESC LIMIT 1
      ) r
      WHERE s."userId" = ${userId}`,
    prisma.$queryRaw<LatestSecurityRow[]>`
      SELECT r.* FROM "Site" s
      CROSS JOIN LATERAL (
        SELECT "siteId", id, score, "headersScore", "sslScore", "cookiesScore", "infoLeakScore", "injectionScore", "createdAt" FROM "SecurityScan"
        WHERE "siteId" = s.id ORDER BY "createdAt" DESC LIMIT 1
      ) r
      WHERE s."userId" = ${userId}`,
  ]);

  const aiBySite = bySiteId(latestAi);
  const availabilityBySite = bySiteId(latestAvailability);
  const securityBySite = bySiteId(latestSecurity);

  return sites.map((s) => {
    const ai = aiBySite.get(s.id);
    const availability = availabilityBySite.get(s.id);
    const security = securityBySite.get(s.id);
    return {
      id: s.id,
      name: s.name,
      url: s.url,
      isActive: s.isActive,
      latestAi: ai
        ? { id: ai.id, score: ai.score, createdAt: ai.createdAt.toISOString() }
        : null,
      latestAvailability: availability
        ? {
            id: availability.id,
            score: availability.score,
            httpStatus: availability.httpStatus,
            pingMs: availability.pingMs,
            loadTimeMs: availability.loadTimeMs,
            createdAt: availability.createdAt.toISOString(),
          }
        : null,
      latestSecurity: security
        ? {
            id: security.id,
            score: security.score,
            headersScore: security.headersScore,
            sslScore: security.sslScore,
            cookiesScore: security.cookiesScore,
            infoLeakScore: security.infoLeakScore,
            injectionScore: security.injectionScore,
            createdAt: security.createdAt.toISOString(),
          }
        : null,
    };
  });
}

/**
 * Daily average score per site over the last 60 days, all check types combined.
 * Returns chart points keyed by site name, plus the names of sites having data.
 */
export async function getScoreHistory(userId: string, sites: { id: string; name: string }[]) {
  // createdAt is stored as UTC timestamp(3): days are UTC days.
  const rows = await prisma.$queryRaw<{ siteId: string; day: string; avg: number }[]>`
    SELECT "siteId", to_char(day, 'YYYY-MM-DD') AS day, avg
    FROM (
      SELECT "siteId", "createdAt"::date AS day, ROUND(AVG(score::numeric), 1)::float8 AS avg
      FROM (
        SELECT "siteId", score, "createdAt" FROM "AnalysisResult"
        UNION ALL
        SELECT "siteId", score, "createdAt" FROM "AvailabilityCheck"
        UNION ALL
        SELECT "siteId", score, "createdAt" FROM "SecurityScan"
      ) t
      WHERE "siteId" IN (SELECT id FROM "Site" WHERE "userId" = ${userId})
        AND "createdAt" >= (now() AT TIME ZONE 'UTC') - interval '60 days'
      GROUP BY 1, 2
    ) daily
    ORDER BY daily.day`;

  const nameById = new Map(sites.map((s) => [s.id, s.name]));
  const pointsByDay = new Map<string, Record<string, string | number>>();
  for (const row of rows) {
    const name = nameById.get(row.siteId);
    if (!name) continue;
    let point = pointsByDay.get(row.day);
    if (!point) {
      point = { date: row.day };
      pointsByDay.set(row.day, point);
    }
    point[name] = row.avg;
  }

  const siteIdsWithData = new Set(rows.map((r) => r.siteId));
  return {
    data: [...pointsByDay.values()],
    siteNames: sites.filter((s) => siteIdsWithData.has(s.id)).map((s) => s.name),
  };
}
