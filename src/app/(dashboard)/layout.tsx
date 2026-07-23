import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

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
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          orgName={org?.name ?? "My organization"}
          userEmail={user.email ?? ""}
          failedCount={failedCount ?? 0}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
