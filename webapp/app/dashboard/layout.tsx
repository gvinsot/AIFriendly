import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/DashboardNav";
import { SessionProvider } from "next-auth/react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/auth/signin");

  return (
    <SessionProvider session={session}>
      <div className="min-h-screen bg-luxe-bg">
        <DashboardNav user={session.user} />
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </div>
    </SessionProvider>
  );
}
