import { getSessionContext } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InviteForm,
  MemberRoleControls,
} from "@/features/settings/components/team-manager";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Team" };

export default async function TeamSettingsPage() {
  const { user, orgId, supabase } = await getSessionContext();

  const { data: members } = await supabase
    .from("org_members")
    .select("user_id, role, created_at")
    .eq("org_id", orgId!)
    .order("created_at");

  // No FK between org_members and profiles (both reference auth.users), so
  // PostgREST can't embed — fetch profiles separately.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", (members ?? []).map((m) => m.user_id));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const myRole = (members ?? []).find((m) => m.user_id === user!.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  // Emails live in auth.users — resolve via the admin API (server only).
  const admin = createAdminClient();
  const emails = new Map<string, string>();
  await Promise.all(
    (members ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      if (data.user?.email) emails.set(m.user_id, data.user.email);
    })
  );

  return (
    <div className="max-w-3xl space-y-4">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
            <CardDescription>
              New users get a Supabase invite email; existing users are added
              directly. Admins manage content and settings, editors create and
              schedule content, viewers are read-only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(members ?? []).map((m) => {
            const profile = profileById.get(m.user_id) ?? null;
            const email = emails.get(m.user_id);
            const name = profile?.full_name ?? email ?? "Member";
            return (
              <div
                key={m.user_id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="size-8 shrink-0 rounded-full"
                    />
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">
                      {name}
                      {m.user_id === user!.id && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {email ?? "—"} · joined {relativeTime(m.created_at)}
                    </div>
                  </div>
                </div>
                <MemberRoleControls
                  userId={m.user_id}
                  role={m.role}
                  isSelf={m.user_id === user!.id}
                  canManage={canManage}
                  callerIsOwner={myRole === "owner"}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
