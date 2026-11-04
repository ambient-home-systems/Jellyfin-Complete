// Small fetch helpers: injectable fetch (tests route to fakes), timeouts, retry on 429/5xx, and rate limiting.
import { APP_VERSION } from '../config.js';
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = `maverick-jellyfin-complete/${APP_VERSION} (+https://github.com/ambient-home-systems/Jellyfin-Complete)`;

export class HttpError extends Error {
  constructor(public status: number, public url: string, public body: string) {
    super(`HTTP ${status} from ${new URL(url).host}${new URL(url).pathname}`);
  }
}

export type RequestOpts = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  json?: unknown;
  timeoutMs?: number;
  retries?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function request(fetchImpl: FetchLike, url: string, opts: RequestOpts = {}): Promise<Response> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const headers: Record<string, string> = { 'user-agent': USER_AGENT, ...opts.headers };
      let body: BodyInit | undefined = opts.body as BodyInit | undefined;
      if (opts.json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(opts.json);
      }
      const res = await fetchImpl(url, { method: opts.method ?? 'GET', headers, body, signal: ctrl.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt;
        await sleep(Math.min(wait, 10_000));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function requestJson<T>(fetchImpl: FetchLike, url: string, opts: RequestOpts = {}): Promise<T> {
  const res = await request(fetchImpl, url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text.slice(0, 500));
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Token bucket: at most `perWindow` calls per `windowMs`. */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(private perWindow: number, private windowMs: number) {}
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.perWindow) {
        this.stamps.push(now);
        return;
      }
      await sleep(this.windowMs - (now - (this.stamps[0] ?? now)) + 5);
    }
  }
}

/** Run async tasks with a concurrency limit. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}
