import "server-only";

/**
 * Posts to ALERT_WEBHOOK_URL (Slack/Discord-compatible: {text, content}
 * body works with both). Silently no-ops if unset — alerting must never
 * break the caller's actual work. Extracted from item-rollup.ts, which
 * used to be the only caller; now shared by every place that needs to
 * surface a failure someone should actually see, not just a row in a
 * table nobody's looking at.
 */
export async function sendAlert(text: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
    });
  } catch {
    // Alerting must never break the calling path.
  }
}