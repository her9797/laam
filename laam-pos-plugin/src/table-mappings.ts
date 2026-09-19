import type { TableMappings } from "./order-sync";

const DEFAULT_TTL_MS = 30_000;

/**
 * 매핑 우선순위: 서버 매핑 -> 플러그인 설정 JSON -> order-sync의 이름 자동 매칭.
 * 서버 호출이 실패하면 조용히 설정 JSON만 사용한다.
 */
export class TableMappingCache {
  private cached: TableMappings | undefined;
  private fetchedAt = 0;

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  async resolve(
    fetchServerMappings: () => Promise<TableMappings>,
    fallback: TableMappings
  ): Promise<TableMappings> {
    if (!this.cached || this.now() - this.fetchedAt >= this.ttlMs) {
      try {
        this.cached = await fetchServerMappings();
        this.fetchedAt = this.now();
      } catch (error) {
        console.warn("lam POS plugin: server table mappings unavailable, using settings JSON", error);
        return { ...fallback };
      }
    }
    return { ...fallback, ...this.cached };
  }
}
