import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSiteSummaries } from "@/lib/dashboard";

// GET /api/dashboard/summary — per-site summary with latest scores for each type
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getSiteSummaries(session.user.id));
}
