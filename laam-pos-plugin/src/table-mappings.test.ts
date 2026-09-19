import { resolveTable } from "./order-sync";
import { TableMappingCache } from "./table-mappings";

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let value = start;
  return { now: () => value, advance: (ms: number) => { value += ms; } };
}

it("prefers server mappings over the fallback settings JSON", async () => {
  const time = clock();
  const cache = new TableMappingCache(30_000, time.now);
  const fetchServer = jest.fn().mockResolvedValue({ "T-01": 111 });

  await expect(cache.resolve(fetchServer, { "T-01": 999, "T-02": 222 })).resolves.toEqual({
    "T-01": 111,
    "T-02": 222
  });
});

it("falls through server mapping, settings JSON and name matching in that order", async () => {
  const time = clock();
  const cache = new TableMappingCache(30_000, time.now);
  const mappings = await cache.resolve(
    jest.fn().mockResolvedValue({ "T-01": 111 }),
    { "T-02": 222 }
  );
  const tables = [
    { id: 111, hallId: 1, title: "룸A" },
    { id: 222, hallId: 1, title: "룸B" },
    { id: 333, hallId: 1, title: "테이블 3" }
  ] as any;

  expect(resolveTable(tables, "T-01", mappings)?.id).toBe(111);
  expect(resolveTable(tables, "T-02", mappings)?.id).toBe(222);
  expect(resolveTable(tables, "T-03", mappings)?.id).toBe(333);
});

it("reuses the cached server mappings for the cache window and refreshes after it", async () => {
  const time = clock();
  const cache = new TableMappingCache(30_000, time.now);
  const fetchServer = jest
    .fn()
    .mockResolvedValueOnce({ "T-01": 111 })
    .mockResolvedValueOnce({ "T-01": 555 });

  await cache.resolve(fetchServer, {});
  time.advance(29_000);
  await expect(cache.resolve(fetchServer, {})).resolves.toEqual({ "T-01": 111 });
  expect(fetchServer).toHaveBeenCalledTimes(1);

  time.advance(2_000);
  await expect(cache.resolve(fetchServer, {})).resolves.toEqual({ "T-01": 555 });
  expect(fetchServer).toHaveBeenCalledTimes(2);
});

it("falls back to the settings JSON silently when the server call fails", async () => {
  const time = clock();
  const cache = new TableMappingCache(30_000, time.now);
  const fetchServer = jest.fn().mockRejectedValue(new Error("HTTP 500"));

  await expect(cache.resolve(fetchServer, { "T-02": 222 })).resolves.toEqual({ "T-02": 222 });
  expect(fetchServer).toHaveBeenCalledTimes(1);
});
