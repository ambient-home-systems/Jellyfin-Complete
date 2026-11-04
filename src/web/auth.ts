// Sign-in with Jellyfin credentials, administrators only (ADR-004). Sessions live in SQLite; the cookie
// holds a random ID only. Every state-changing request must carry the session's CSRF token.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext } from '../app-context.js';
import { session } from '../db/schema.js';

export const COOKIE = 'mc_session';
const TTL = 30 * 86_400_000;

export type SessionUser = { id: string; name: string; csrf: string; sessionId: string };

/** `secure` comes from isHttps(): HTTPS directly or through a trusted reverse proxy. */
export function createSession(app: AppContext, c: Context, user: { id: string; name: string }, secure = new URL(c.req.url).protocol === 'https:'): void {
  const id = randomBytes(32).toString('hex');
  const now = Date.now();
  app.db.delete(session).where(lt(session.expiresAt, now)).run();
  app.db.insert(session).values({ id, userId: user.id, userName: user.name, csrf: randomBytes(16).toString('hex'), createdAt: now, expiresAt: now + TTL }).run();
  setCookie(c, COOKIE, id, { httpOnly: true, sameSite: 'Strict', secure, path: '/', maxAge: TTL / 1000 });
}

export function endSession(app: AppContext, c: Context): void {
  const id = getCookie(c, COOKIE);
  if (id) app.db.delete(session).where(eq(session.id, id)).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function requireAuth(app: AppContext): MiddlewareHandler {
  return async (c, next) => {
    const id = getCookie(c, COOKIE);
    const row = id ? app.db.select().from(session).where(and(eq(session.id, id), gt(session.expiresAt, Date.now()))).get() : undefined;
    if (!row) {
      if (c.req.header('hx-request')) {
        c.header('HX-Redirect', '/login');
        return c.body(null, 401);
      }
      return c.redirect('/login');
    }
    const user: SessionUser = { id: row.userId, name: row.userName, csrf: row.csrf, sessionId: row.id };
    c.set('user' as never, user as never);
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      let token = c.req.header('x-csrf-token') ?? '';
      if (!token && (c.req.header('content-type') ?? '').includes('form')) {
        const body = await c.req.parseBody();
        token = String(body._csrf ?? '');
      }
      if (!token || !sameToken(token, row.csrf)) return c.text('Your session form token is missing or out of date. Reload the page and try again.', 403);
    }
    await next();
  };
}

export const userOf = (c: Context): SessionUser => c.get('user' as never) as SessionUser;
