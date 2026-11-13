// Access tokens for the MCP endpoint (ADR-032). A token is shown once when it's created; only its SHA-256 hash and
// last four characters are stored, so a copy of the database can't be used to call the endpoint.
import { createHash, randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { apiToken } from '../db/schema.js';

export type TokenScope = 'read' | 'review' | 'full';
export type ApiToken = typeof apiToken.$inferSelect;

export const SCOPE_LABEL: Record<TokenScope, string> = {
  read: 'Read only',
  review: 'Read, review and run',
  full: 'Full control',
};

const PREFIX = 'mjc_';
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

export function createToken(db: DB, name: string, scope: TokenScope, by: string, now = Date.now()): { token: string; row: ApiToken } {
  const token = PREFIX + randomBytes(32).toString('base64url');
  const row = db.insert(apiToken).values({ name, hash: hashOf(token), hint: token.slice(-4), scope, createdBy: by, createdAt: now }).returning().get();
  return { token, row };
}

export const listTokens = (db: DB): ApiToken[] => db.select().from(apiToken).orderBy(desc(apiToken.createdAt)).all();

export function revokeToken(db: DB, id: number): boolean {
  return db.delete(apiToken).where(eq(apiToken.id, id)).run().changes > 0;
}

/** The token row for a presented token, or null. Marks it used (at most once a minute, to spare the disk). */
export function verifyToken(db: DB, presented: string, now = Date.now()): ApiToken | null {
  if (!presented.startsWith(PREFIX) || presented.length > 200) return null;
  const row = db.select().from(apiToken).where(eq(apiToken.hash, hashOf(presented))).get();
  if (!row) return null;
  if (!row.lastUsedAt || now - row.lastUsedAt > 60_000) db.update(apiToken).set({ lastUsedAt: now }).where(eq(apiToken.id, row.id)).run();
  return row;
}
