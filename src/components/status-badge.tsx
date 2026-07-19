import { Badge } from "@/components/ui/badge";

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning" | "outline"
> = {
  draft: "secondary",
  scheduled: "default",
  publishing: "warning",
  published: "success",
  partially_published: "warning",
  failed: "destructive",
  archived: "outline",
  active: "success",
  paused: "warning",
  completed: "outline",
  pending: "secondary",
  queued: "secondary",
  skipped: "outline",
  expired: "destructive",
  revoked: "destructive",
  error: "destructive",
  proposed: "secondary",
  accepted: "success",
  dismissed: "outline",
  done: "success",
  running: "warning",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "outline"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
