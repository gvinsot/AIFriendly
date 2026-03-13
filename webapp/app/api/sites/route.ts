import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
    frequency: s.frequency,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
    _count: s._count,
    lastScore: s.analyses[0]?.score ?? null,
  }));

  return NextResponse.json(result);
}

// POST /api/sites — create a new site
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await request.json();
  const { name, url, frequency } = body as {
    name?: string;
    url?: string;
    frequency?: string;
  };

  if (!name?.trim() || !url?.trim()) {
    return NextResponse.json(
      { error: "Le nom et l'URL sont requis." },
      { status: 400 }
    );
  }

  const validFrequencies = ["6h", "daily", "weekly", "monthly"];
  const freq = validFrequencies.includes(frequency || "")
    ? frequency!
    : "daily";

  // Limit to 20 sites per user
  const count = await prisma.site.count({
    where: { userId: session.user.id },
  });
  if (count >= 20) {
    return NextResponse.json(
      { error: "Limite de 20 sites atteinte." },
      { status: 400 }
    );
  }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const site = await prisma.site.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      url: normalizedUrl,
      frequency: freq,
    },
  });

  return NextResponse.json(site, { status: 201 });
}
