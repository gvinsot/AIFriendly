import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireSubscribedUser, readJsonObject } from "@/lib/api-auth";
import { validateAndNormalizeUrl } from "@/lib/urlSecurity";

const MAX_SITE_NAME_LENGTH = 100;

// GET /api/sites — list current user's sites
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const sites = await prisma.site.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { analyses: true } },
      analyses: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { score: true },
      },
    },
  });

  const result = sites.map((s: typeof sites[number]) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
    _count: s._count,
    lastScore: s.analyses[0]?.score ?? null,
  }));

  return NextResponse.json(result);
}

// POST /api/sites — create a new site
export async function POST(request: Request) {
  const guard = await requireSubscribedUser();
  if (guard.response) return guard.response;
  const userId = guard.userId;

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const url = typeof body.url === "string" ? body.url : undefined;

  if (!name?.trim() || !url?.trim()) {
    return NextResponse.json(
      { error: "Le nom et l'URL sont requis." },
      { status: 400 }
    );
  }

  // Limit to 20 sites per user
  if (name.trim().length > MAX_SITE_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Le nom ne doit pas dépasser ${MAX_SITE_NAME_LENGTH} caractères.` },
      { status: 400 }
    );
  }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  // Empêche d'enregistrer une cible interne (SSRF via le worker / scans)
  const validation = validateAndNormalizeUrl(normalizedUrl);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const count = await prisma.site.count({
    where: { userId },
  });
  if (count >= 20) {
    return NextResponse.json(
      { error: "Limite de 20 sites atteinte." },
      { status: 400 }
    );
  }

  const site = await prisma.site.create({
    data: {
      userId,
      name: name.trim(),
      url: normalizedUrl,
    },
  });

  return NextResponse.json(site, { status: 201 });
}
