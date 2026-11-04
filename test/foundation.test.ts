import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/index.js';
import { SecretStore, loadOrCreateKey, encrypt, decrypt } from '../src/secrets.js';
import { redact, registerSecret } from '../src/log.js';
import { getSettings, updateSettings } from '../src/settings.js';

describe('secrets', () => {
  it('round-trips with AES-256-GCM and rejects tampering', () => {
    const key = loadOrCreateKey(mkdtempSync(join(tmpdir(), 'mc-')));
    const c = encrypt(key, 'super-secret-api-key');
    expect(decrypt(key, c)).toBe('super-secret-api-key');
    const tampered = Buffer.from(c, 'base64');
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => decrypt(key, tampered.toString('base64'))).toThrow();
  });

  it('stores keys encrypted, shows only last4, and registers them for redaction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-'));
    const db = openDb(':memory:');
    const store = new SecretStore(db, loadOrCreateKey(dir));
    store.set('tmdb.apiKey', 'abcdef1234567890');
    expect(store.get('tmdb.apiKey')).toBe('abcdef1234567890');
    expect(store.masked('tmdb.apiKey')).toEqual({ set: true, last4: '7890' });
    expect(redact('calling with abcdef1234567890 now')).toBe('calling with «redacted» now');
    const raw = db.$client.prepare('select ciphertext from secret').get() as { ciphertext: string };
    expect(raw.ciphertext).not.toContain('abcdef');
  });
});

describe('log redaction', () => {
  it('scrubs registered values and api_key query params', () => {
    registerSecret('plex-token-xyz123');
    expect(redact('GET /x?X-Plex-Token=plex-token-xyz123&a=1')).not.toContain('xyz123');
    expect(redact('https://api.themoviedb.org/3/find/tt1?api_key=zzzzzzzzzz')).toContain('api_key=«redacted»');
  });
});

describe('settings', () => {
  it('defaults to dry run on with ADR-007 modes, and merges updates', () => {
    const db = openDb(':memory:');
    const s = getSettings(db, 'America/New_York');
    expect(s.dryRun).toBe(true);
    expect(s.modes['collection.remove_items']).toBe('review');
    expect(s.guardrails.arrCapPerRun).toBe(10);
    updateSettings(db, { dryRun: false, guardrails: { arrCapPerRun: 5, releasedOnly: true } });
    const t = getSettings(db, 'America/New_York');
    expect(t.dryRun).toBe(false);
    expect(t.guardrails.arrCapPerRun).toBe(5);
    expect(t.timezone).toBe('America/New_York');
  });
});
