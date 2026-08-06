import { vi } from "vitest";

export interface FakeQuery {
  calls: Array<[string, unknown[]]>;
  // chainable builder methods, all recorded
  [method: string]: unknown;
}

/**
 * A chainable, awaitable stand-in for a supabase-js query builder.
 * Every builder method returns the same object; awaiting it resolves to
 * `result`. Calls are recorded as [method, args] for assertions.
 */
export function fakeQuery(result: unknown): FakeQuery {
  const q: FakeQuery = { calls: [] };
  for (const m of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "in",
    "lt",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
  ]) {
    q[m] = vi.fn((...args: unknown[]) => {
      q.calls.push([m, args]);
      return q;
    });
  }
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}

/**
 * A fake supabase client whose `from(table)` hands out prepared queries in
 * call order. Throws if the code under test queries an unexpected table.
 */
export function fakeClient(plan: Array<{ table: string; query: FakeQuery }>) {
  let i = 0;
  return {
    from: vi.fn((table: string) => {
      const step = plan[i++];
      if (!step) throw new Error(`Unexpected query #${i} on table "${table}"`);
      if (step.table !== table) {
        throw new Error(
          `Query #${i} hit table "${table}", expected "${step.table}"`
        );
      }
      return step.query;
    }),
  };
}
