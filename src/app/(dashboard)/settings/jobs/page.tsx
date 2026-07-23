import { getSessionContext } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Jobs" };

export default async function JobsSettingsPage() {
  const { user, orgId, supabase } = await getSessionContext();

  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId!)
    .eq("user_id", user!.id)
    .single();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        Only owners and admins can view job runs.
      </p>
    );
  }

  // job_runs is service-role only (global operational data, no org rows).
  const admin = createAdminClient();
  const { data: runs } = await admin
    .from("job_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(50);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Background job runs</CardTitle>
        <CardDescription>
          Publishing, monitoring, and maintenance jobs — most recent 50 runs.
          In development these fire from <code>npm run worker</code>; in
          production from pg_cron.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(runs ?? []).map((run) => {
              const duration =
                run.finished_at != null
                  ? `${Math.max(
                      0,
                      new Date(run.finished_at).getTime() -
                        new Date(run.started_at).getTime()
                    )}ms`
                  : "running…";
              return (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">{run.job}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {relativeTime(run.started_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {duration}
                  </TableCell>
                  <TableCell>{run.items_processed}</TableCell>
                  <TableCell>
                    {run.ok === null ? (
                      <Badge variant="secondary">running</Badge>
                    ) : run.ok ? (
                      <Badge variant="success">ok</Badge>
                    ) : (
                      <Badge variant="destructive" title={run.error ?? ""}>
                        failed
                      </Badge>
                    )}
                    {run.error && (
                      <div
                        className="mt-1 max-w-md truncate text-xs text-destructive"
                        title={run.error}
                      >
                        {run.error}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {(runs ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No job runs recorded yet — start the dev worker or configure
                  pg_cron.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
