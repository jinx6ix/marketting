/**
 * Translate raw Supabase/Postgres error messages into UI-friendly strings
 * for common cases the user can actually fix. Anything we don't recognize
 * falls through unchanged so nothing is lost.
 */

const MIGRATION_HINT =
  "Tip: database migrations may not be applied to this Supabase project. " +
  "Run `npm run fix:approvals-constraint` (or apply supabase/migrations/0009_approval_ai_usage.sql " +
  "in the Supabase SQL Editor) and retry.";

export function friendlyActionError(
  error: { message?: string | null; code?: string | null } | null | undefined,
  fallback = "Action failed"
): string {
  if (!error?.message) return fallback;
  const msg = error.message;

  if (
    error.code === "23514" &&
    msg.includes("marketing_items_status_check")
  ) {
    return `Cannot change item status because this database doesn't allow it yet. ${MIGRATION_HINT}`;
  }
  if (msg.includes("violates check constraint")) {
    return `${msg.split("\n")[0]}. ${MIGRATION_HINT}`;
  }
  return msg;
}
