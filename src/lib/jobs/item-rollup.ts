import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

async function sendFailureAlert(text: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
    });
  } catch {
    // Alerting must never break the publishing path.
  }
}

/**
 * Roll up a marketing_item's status from its post_targets.
 *
 * - If any target is still pending/queued/publishing → leave the item as-is
 *   (a worker is mid-flight, don't clobber the in-progress status).
 * - Otherwise → published / partially_published / failed based on final
 *   target counts. Sends an optional ops alert when not fully published.
 */
export async function rollupItemStatus(itemId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: targets } = await admin
    .from("post_targets")
    .select("status")
    .eq("item_id", itemId);
  if (!targets || targets.length === 0) return;

  const statuses = new Set(targets.map((t) => t.status));
  const anyPendingWork =
    statuses.has("pending") ||
    statuses.has("queued") ||
    statuses.has("publishing");
  if (anyPendingWork) return;

  const published = targets.filter((t) => t.status === "published").length;
  const failed = targets.filter((t) => t.status === "failed").length;

  let status: "published" | "partially_published" | "failed";
  if (published > 0 && failed === 0) status = "published";
  else if (published > 0) status = "partially_published";
  else status = "failed";

  await admin.from("marketing_items").update({ status }).eq("id", itemId);

  if (status !== "published") {
    const { data: item } = await admin
      .from("marketing_items")
      .select("title")
      .eq("id", itemId)
      .single();
    await sendFailureAlert(
      `Post "${item?.title ?? itemId}" finished as ${status.replace(
        "_",
        " "
      )} ` +
        `(${published} published, ${failed} failed). ` +
        `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/items/${itemId}`
    );
  }
}
