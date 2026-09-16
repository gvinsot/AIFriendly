import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getScoreHistory, getSiteSummaries } from "@/lib/dashboard";
import { DashboardContent, ScoreHistoryPanel } from "./DashboardContent";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const userId = session.user.id;
  const sites = await getSiteSummaries(userId);

  // The history aggregates every check of the last 60 days: stream it so the
  // site cards do not wait for it.
  return (
    <DashboardContent
      sites={sites}
      scoreHistory={
        <Suspense
          fallback={
            <div className="flex justify-center py-8">
              <div className="size-5 rounded-full border-2 border-luxe-gold border-t-transparent animate-spin" />
            </div>
          }
        >
          <ScoreHistory userId={userId} sites={sites} />
        </Suspense>
      }
    />
  );
}

async function ScoreHistory({ userId, sites }: { userId: string; sites: { id: string; name: string }[] }) {
  const { data, siteNames } = await getScoreHistory(userId, sites);
  if (data.length === 0 || siteNames.length === 0) return null;
  return <ScoreHistoryPanel data={data} siteNames={siteNames} />;
}
