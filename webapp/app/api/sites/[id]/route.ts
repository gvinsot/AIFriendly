import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/sites/:id — get site info
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await context.params;
  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    id: site.id,
    name: site.name,
    url: site.url,
    frequency: site.frequency,
    isActive: site.isActive,
    availabilityEnabled: site.availabilityEnabled,
    securityEnabled: site.securityEnabled,
  });
}

// PUT /api/sites/:id — update site
export async function PUT(request: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const { name, url, frequency, isActive } = body as {
    name?: string;
    url?: string;
    frequency?: string;
    isActive?: boolean;
  };

  const validFrequencies = ["6h", "daily", "weekly", "monthly"];
  const data: Record<string, unknown> = {};
  if (name?.trim()) data.name = name.trim();
  if (url?.trim()) {
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    data.url = normalizedUrl;
  }
  if (frequency && validFrequencies.includes(frequency)) {
    data.frequency = frequency;
  }
  if (typeof isActive === "boolean") data.isActive = isActive;

  const updated = await prisma.site.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}

// DELETE /api/sites/:id — delete site and all analyses
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  await prisma.site.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
