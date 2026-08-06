import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, fakeQuery } from "../../../test/helpers/supabase-mock";

const admin = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => admin.current,
}));

import { rollupItemStatus } from "./item-rollup";

const ITEM = "11111111-1111-1111-1111-111111111111";

function targets(...statuses: string[]) {
  return { data: statuses.map((status) => ({ status })) };
}

describe("rollupItemStatus", () => {
  const fetchMock = vi.fn(async () => new Response("ok"));

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    delete process.env.ALERT_WEBHOOK_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing while any target is still in flight", async () => {
    for (const inFlight of ["pending", "queued", "publishing"]) {
      const read = fakeQuery(targets("published", inFlight));
      admin.current = fakeClient([{ table: "post_targets", query: read }]);
      await rollupItemStatus(ITEM);
      // plan had no marketing_items step — an update would have thrown
    }
  });

  it("does nothing when the item has no targets", async () => {
    admin.current = fakeClient([
      { table: "post_targets", query: fakeQuery({ data: [] }) },
    ]);
    await rollupItemStatus(ITEM);
  });

  it("rolls up to published when every target succeeded", async () => {
    const update = fakeQuery({ error: null });
    admin.current = fakeClient([
      { table: "post_targets", query: fakeQuery(targets("published", "published")) },
      { table: "marketing_items", query: update },
    ]);
    await rollupItemStatus(ITEM);
    expect(update.calls[0]).toEqual(["update", [{ status: "published" }]]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rolls up to partially_published on a mix and sends an alert", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/alerts";
    const update = fakeQuery({ error: null });
    admin.current = fakeClient([
      { table: "post_targets", query: fakeQuery(targets("published", "failed")) },
      { table: "marketing_items", query: update },
      {
        table: "marketing_items",
        query: fakeQuery({ data: { title: "Mara promo" } }),
      },
    ]);
    await rollupItemStatus(ITEM);
    expect(update.calls[0]).toEqual([
      "update",
      [{ status: "partially_published" }],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown[])[1]!["body" as never]
    );
    expect(body.text).toContain("Mara promo");
    expect(body.text).toContain("partially published");
  });

  it("rolls up to failed when nothing published", async () => {
    const update = fakeQuery({ error: null });
    admin.current = fakeClient([
      { table: "post_targets", query: fakeQuery(targets("failed", "skipped")) },
      { table: "marketing_items", query: update },
      { table: "marketing_items", query: fakeQuery({ data: { title: "t" } }) },
    ]);
    await rollupItemStatus(ITEM);
    expect(update.calls[0]).toEqual(["update", [{ status: "failed" }]]);
    // no webhook configured → alert helper returns without fetching
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never lets a webhook failure break the rollup", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/alerts";
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    admin.current = fakeClient([
      { table: "post_targets", query: fakeQuery(targets("failed")) },
      { table: "marketing_items", query: fakeQuery({ error: null }) },
      { table: "marketing_items", query: fakeQuery({ data: { title: "t" } }) },
    ]);
    await expect(rollupItemStatus(ITEM)).resolves.toBeUndefined();
  });
});
