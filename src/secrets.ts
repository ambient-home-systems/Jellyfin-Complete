// API keys at rest: AES-256-GCM with a key file in /config (ADR-022). The UI only ever sees last4.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { DB } from './db/index.js';
import { secret } from './db/schema.js';
import { registerSecret } from './log.js';

export type SecretName =
  | 'jellyfin.apiKey' | 'tmdb.apiKey' | 'mdblist.apiKey' | 'plex.token' | 'radarr.apiKey' | 'sonarr.apiKey' | 'imdb.snapshotToken';

export function loadOrCreateKey(configDir: string): Buffer {
  const path = join(configDir, 'secret.key');
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`${path} is not a 32-byte base64 key`);
    return key;
  }
  mkdirSync(configDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString('base64') + '\n', { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort on odd filesystems */ }
  return key;
}

export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

export function decrypt(key: Buffer, ciphertext: string): string {
  const raw = Buffer.from(ciphertext, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

export class SecretStore {
  constructor(private db: DB, private key: Buffer) {
    // Register every stored secret with the logger so it can never be printed.
    for (const row of this.db.select().from(secret).all()) registerSecret(this.tryDecrypt(row.ciphertext));
  }

  private tryDecrypt(c: string): string | null {
    try { return decrypt(this.key, c); } catch { return null; }
  }

  get(name: SecretName): string | null {
    const row = this.db.select().from(secret).where(eq(secret.name, name)).get();
    return row ? this.tryDecrypt(row.ciphertext) : null;
  }

  set(name: SecretName, value: string): void {
    registerSecret(value);
    const values = { ciphertext: encrypt(this.key, value), last4: value.slice(-4), updatedAt: Date.now() };
    this.db.insert(secret).values({ name, ...values }).onConflictDoUpdate({ target: secret.name, set: values }).run();
  }

  clear(name: SecretName): void {
    this.db.delete(secret).where(eq(secret.name, name)).run();
  }

  /** Masked view for the UI: only the last 4 characters, never the value. */
  masked(name: SecretName): { set: boolean; last4: string | null } {
    const row = this.db.select().from(secret).where(eq(secret.name, name)).get();
    return { set: Boolean(row), last4: row?.last4 ?? null };
  }
}
