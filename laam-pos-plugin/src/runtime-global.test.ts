import { ensureWorkerGlobal } from "./runtime-global";

it("aliases self to globalThis before the Toss SDK is imported", () => {
  const runtime = globalThis as unknown as { self?: unknown };
  const original = runtime.self;
  delete runtime.self;

  try {
    ensureWorkerGlobal();
    expect(runtime.self).toBe(globalThis);
  } finally {
    if (original === undefined) {
      delete runtime.self;
    } else {
      runtime.self = original;
    }
  }
});
