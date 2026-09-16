export function ensureWorkerGlobal(): void {
  const runtime = globalThis as unknown as { self?: unknown };
  if (runtime.self === undefined) {
    runtime.self = globalThis;
  }
}
