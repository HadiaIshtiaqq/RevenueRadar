interface Entry<T> { value: T; expiresAt: number }

export class TTLCache<T> {
  private store = new Map<string, Entry<T>>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) { this.store.delete(key); return undefined; }
    return e.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  wrap<A extends unknown[]>(
    key: string,
    fn: (...args: A) => Promise<T>,
    ...args: A
  ): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    return fn(...args).then(v => { this.set(key, v); return v; });
  }
}

export type SerpResult = { title: string; url: string; snippet: string };

export const serpCache    = new TTLCache<SerpResult[]>(15 * 60 * 1000);  // 15 min
export const scrapeCache  = new TTLCache<string>(30 * 60 * 1000);        // 30 min
export const geocodeCache = new TTLCache<{ lat: number; lng: number; city: string }>(24 * 60 * 60 * 1000); // 24 h
