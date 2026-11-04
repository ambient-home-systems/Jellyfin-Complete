// Hardening for installs reachable beyond a LAN (Phase 4, ADR-031): who's asking (behind a trusted reverse proxy or
// not), whether the request came over HTTPS, a limiter for sign-in and setup attempts, and the first-run setup code.
import { randomInt, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/** The client's address. X-Forwarded-For is only believed when TRUST_PROXY is set (a reverse proxy in front). */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // no socket (tests, in-process requests)
  }
}

/** True when the browser is talking HTTPS: directly, or to a trusted proxy that says so. */
export function isHttps(c: Context, trustProxy: boolean): boolean {
  if (trustProxy && c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() === 'https') return true;
  return new URL(c.req.url).protocol === 'https:';
}

/** Failed attempts per key (IP, username) in a sliding window; past the limit, the key is locked for the window. */
export class AttemptLimiter {
  private fails = new Map<string, number[]>();

  constructor(private max = 5, private windowMs = 15 * 60_000, private now: () => number = Date.now) {}

  /** Seconds until any of these keys may try again, or 0 if none is locked. */
  retryAfter(keys: string[]): number {
    const t = this.now();
    let wait = 0;
    for (const k of keys) {
      const recent = (this.fails.get(k) ?? []).filter((x) => t - x < this.windowMs);
      this.fails.set(k, recent);
      if (recent.length >= this.max) wait = Math.max(wait, Math.ceil((recent[0]! + this.windowMs - t) / 1000));
    }
    return wait;
  }

  fail(keys: string[]): void {
    const t = this.now();
    for (const k of keys) this.fails.set(k, [...(this.fails.get(k) ?? []), t].slice(-this.max * 2));
  }

  succeed(keys: string[]): void {
    for (const k of keys) this.fails.delete(k);
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

/** An 8-character code like "K7QM-2XRD", shown in the container log on first start. */
export function newSetupCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Compare codes ignoring case, spaces and dashes, in constant time. */
export function sameCode(given: string, expected: string): boolean {
  const norm = (s: string) => Buffer.from(s.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const a = norm(given);
  const b = norm(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
