import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, fakeQuery, type FakeQuery } from "../../../test/helpers/supabase-mock";

const session = vi.hoisted(() => ({ current: null as unknown }));
const reapStalePublishesMock = vi.hoisted(() => vi.fn(async () => 0));

vi.mock("@/lib/supabase/server", () => ({
  getSessionContext: async () => session.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// publishNow now awaits publishDue() via withTimeout(), not fire-and-forget
// — both are imported from this module, so the mock needs to provide both.
// withTimeout here is a simplified passthrough (no real timeout race);
// that's fine for these tests since the mocked publishDue always resolves
// immediately.
vi.mock("@/lib/jobs/publish", () => ({
  publishDue: vi.fn(async () => {}),
  withTimeout: async (promise: Promise<unknown>) => promise,
}));
// publishNow calls reapStalePublishes() when an item is already
// "publishing" (see the "still publishing" / "reap clears it" tests
// below). That function reaches for the real createAdminClient(), not
// the fakeClient plan the rest of this file drives via
// getSessionContext().supabase — so it needs its own explicit mock the
// same way publishDue does, or it throws "supabaseUrl is required" in a
// test environment with no real Supabase env vars set.
vi.mock("@/lib/jobs/stale-publish", () => ({
  reapStalePublishes: reapStalePublishesMock,
}));

import { publishNow } from "./actions";

const ID = "22222222-2222-2222-2222-222222222222";

function sessionWith(plan: Array<{ table: string; query: FakeQuery }>) {
  session.current = {
    user: { id: "user-1" },
    orgId: "org-1",
    supabase: fakeClient(plan),
  };
}

function target(id: string, status: string) {
  return { id, status };
}

describe("publishNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reapStalePublishesMock.mockClear();
    reapStalePublishesMock.mockImplementation(async () => 0);
  });

  it("rejects unauthenticated calls", async () => {
    session.current = { user: null, orgId: null, supabase: null };
    expect(await publishNow(ID)).toEqual({ error: "Unauthorized" });
  });

  it("rejects archived items outright", async () => {
    sessionWith([
      {
        table: "marketing_items",
        query: fakeQuery({ data: { status: "archived" } }),
      },
    ]);
    const res = await publishNow(ID);
    expect(res.error).toContain("archived");
    expect(reapStalePublishesMock).not.toHaveBeenCalled();
  });

  it("attempts a stale-publish reap when an item is already publishing, and rejects if it's still publishing afterward", async () => {
    sessionWith([
      {
        table: "marketing_items",
        query: fakeQuery({ data: { status: "publishing" } }),
      },
      // Re-check after reaping — nothing was actually stale, so it's
      // still genuinely mid-publish.
      {
        table: "marketing_items",
        query: fakeQuery({ data: { status: "publishing" } }),
      },
    ]);
    const res = await publishNow(ID);
    expect(reapStalePublishesMock).toHaveBeenCalledTimes(1);
    expect(res.error).toContain("publishing");
  });

  it("when the reap clears a stuck publishing item, retry proceeds normally instead of being rejected", async () => {
    const targetUpdate = fakeQuery({ error: null });
    sessionWith([
      {
        table: "marketing_items",
        query: fakeQuery({ data: { status: "publishing" } }),
      },
      // Re-check after reaping — the reap cleared it to failed, so this
      // is now a normal partial-retry case, not still-publishing.
      {
        table: "marketing_items",
        query: fakeQuery({ data: { status: "failed" } }),
      },
      {
        table: "post_targets",
        query: fakeQuery({
          data: [target("pub-1", "published"), target("fail-1", "failed")],
        }),
      },
      { table: "marketing_items", query: fakeQuery({ error: null }) },
      { table: "post_targets", query: targetUpdate },
    ]);

    const res = await publishNow(ID);
    expect(reapStalePublishesMock).toHaveBeenCalledTimes(1);
    expect(res.error).toBeUndefined();
    expect(res.queued).toBe(1);
    expect(res.alreadyPublished).toBe(1);
  });

  it("errors when the item has no targets", async () => {
    sessionWith([
      { table: "marketing_items", query: fakeQuery({ data: { status: "draft" } }) },
      { table: "post_targets", query: fakeQuery({ data: [] }) },
    ]);
    expect((await publishNow(ID)).error).toMatch(/no saved publish targets/);
  });

  it("refuses to re-send when every target is already published", async () => {
    sessionWith([
      {
        table: "marketing_items",
        query: fakeQuery({ data: { status: "partially_published" } }),
      },
      {
        table: "post_targets",
        query: fakeQuery({ data: [target("a", "published"), target("b", "published")] }),
      },
    ]);
    const res = await publishNow(ID);
    expect(res.error).toMatch(/already published/);
  });

  it("on a partial item, only resets failed/skipped targets — never published ones", async () => {
    const targetUpdate = fakeQuery({ error: null });
    sessionWith([
      {
        table: "marketing_items",
        query: fakeQuery({ data: { status: "partially_published" } }),
      },
      {
        table: "post_targets",
        query: fakeQuery({
          data: [
            target("pub-1", "published"),
            target("fail-1", "failed"),
            target("skip-1", "skipped"),
          ],
        }),
      },
      { table: "marketing_items", query: fakeQuery({ error: null }) },
      { table: "post_targets", query: targetUpdate },
    ]);

    const res = await publishNow(ID);
    expect(res.error).toBeUndefined();
    expect(res.queued).toBe(2);
    expect(res.alreadyPublished).toBe(1);

    const inCalls = targetUpdate.calls.filter(([m]) => m === "in");
    expect(inCalls[0]).toEqual(["in", ["id", ["fail-1", "skip-1"]]]);
    // and the update is double-guarded by a status allowlist without 'published'
    expect(inCalls[1]![1][1]).not.toContain("published");
  });

  it("on a fresh item, queues all non-published targets", async () => {
    const targetUpdate = fakeQuery({ error: null });
    sessionWith([
      { table: "marketing_items", query: fakeQuery({ data: { status: "draft" } }) },
      {
        table: "post_targets",
        query: fakeQuery({ data: [target("a", "pending"), target("b", "queued")] }),
      },
      { table: "marketing_items", query: fakeQuery({ error: null }) },
      { table: "post_targets", query: targetUpdate },
    ]);

    const res = await publishNow(ID);
    expect(res.queued).toBe(2);
    expect(res.alreadyPublished).toBe(0);
    const inCalls = targetUpdate.calls.filter(([m]) => m === "in");
    expect(inCalls[0]).toEqual(["in", ["id", ["a", "b"]]]);
  });
});