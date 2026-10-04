import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/guard";
import { readUnreviewedUncertaintyCount, readUnresolvedAppErrorCount } from "@/lib/data/observability";
import { readAllTokenMarks } from "@/lib/data/marks";
import { AdminShell } from "../components/AdminShell";

export const dynamic = "force-dynamic";

async function navBadges(): Promise<Record<string, number>> {
  const [reviewCount, allMarks, errorCount] = await Promise.all([
    readUnreviewedUncertaintyCount(),
    readAllTokenMarks(),
    readUnresolvedAppErrorCount(),
  ]);
  const activeMarksCount = allMarks.filter((m) => !m.lifted_at).length;

  return {
    "/admin/review": reviewCount,
    "/admin/marks": activeMarksCount,
    "/admin/logs": errorCount,
  };
}


/** Guards every dashboard route. Login lives outside this group. */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireAdmin();
  const u = session.user as { username?: string; name?: string; email: string };
  const badges = await navBadges();
  return (
    <AdminShell username={u.username ?? u.name ?? u.email} badges={badges}>
      {children}
    </AdminShell>
  );
}
