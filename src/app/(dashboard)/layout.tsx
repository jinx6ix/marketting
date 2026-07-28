import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user) redirect("/login");
  if (!orgId) redirect("/signup");

  const [{ data: org }, { count: failedCount }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).single(),
    supabase
      .from("marketing_items")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "failed"),
  ]);

  return (
    <DashboardShell
      orgName={org?.name ?? "My organization"}
      userEmail={user.email ?? ""}
      failedCount={failedCount ?? 0}
    >
      {children}
    </DashboardShell>
  );
}
