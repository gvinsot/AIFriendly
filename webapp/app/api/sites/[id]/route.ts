import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireSubscribedUser, readJsonObject } from "@/lib/api-auth";
import { validateAndNormalizeUrl } from "@/lib/urlSecurity";
import { ownershipHost } from "@/lib/site-ownership";

const MAX_SITE_NAME_LENGTH = 100;

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
    isActive: site.isActive,
    availabilityEnabled: site.availabilityEnabled,
    securityEnabled: site.securityEnabled,
  });
}

// PUT /api/sites/:id — update site
export async function PUT(request: NextRequest, context: RouteContext) {
  const guard = await requireSubscribedUser();
  if (guard.response) return guard.response;

  const { id } = await context.params;
  const existing = await prisma.site.findFirst({
    where: { id, userId: guard.userId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const url = typeof body.url === "string" ? body.url : undefined;
  const isActive = body.isActive;

  const data: Record<string, unknown> = {};
  if (name?.trim()) {
    if (name.trim().length > MAX_SITE_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Le nom ne doit pas dépasser ${MAX_SITE_NAME_LENGTH} caractères.` },
        { status: 400 }
      );
    }
    data.name = name.trim();
  }
  if (url?.trim()) {
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    // Empêche d'enregistrer une cible interne (SSRF via le worker / scans)
    const validation = validateAndNormalizeUrl(normalizedUrl);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    data.url = normalizedUrl;
    // La preuve de propriété ne vaut que pour l'hôte vérifié.
    if (ownershipHost(normalizedUrl) !== ownershipHost(existing.url)) {
      data.ownershipVerifiedAt = null;
      data.ownershipVerifiedHost = null;
      data.ownershipMethod = null;
    }
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
