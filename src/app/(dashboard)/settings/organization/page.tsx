import { getSessionContext } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrgForm } from "@/features/settings/components/org-form";

export const metadata = { title: "Organization" };

export default async function OrganizationSettingsPage() {
  const { user, orgId, supabase } = await getSessionContext();

  const [{ data: org }, { data: membership }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, timezone, industry_niche")
      .eq("id", orgId!)
      .single(),
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId!)
      .eq("user_id", user!.id)
      .single(),
  ]);

  const canEdit = ["owner", "admin"].includes(membership?.role ?? "");

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          {canEdit
            ? "Business profile used across scheduling and AI features."
            : "Only owners and admins can edit these settings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OrgForm
          initial={{
            name: org?.name ?? "",
            timezone: org?.timezone ?? "UTC",
            industry_niche: org?.industry_niche ?? [],
          }}
          readOnly={!canEdit}
        />
      </CardContent>
    </Card>
  );
}
