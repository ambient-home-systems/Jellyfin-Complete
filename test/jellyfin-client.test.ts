import { describe, it, expect, beforeEach } from 'vitest';
import { JellyfinClient } from '../src/clients/jellyfin/index.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';

describe('JellyfinClient against the 12.4 fake', () => {
  let fake: FakeJellyfin;
  let jf: JellyfinClient;
  beforeEach(() => {
    fake = new FakeJellyfin();
    fake.add({ Id: 'm1', Name: 'Home Alone', Type: 'Movie', ParentId: 'lib-movies', ProviderIds: { Imdb: 'tt0099785', Tmdb: '771' } });
    fake.add({ Id: 'm2', Name: 'Elf', Type: 'Movie', ParentId: 'lib-movies', ProviderIds: { Imdb: 'tt0319343', Tmdb: '10719' } });
    jf = new JellyfinClient({ baseUrl: FAKE_URL, apiKey: fake.apiKey, fetch: fake.fetch() });
  });

  it('pages items and always sends CollapseBoxSetItems=false', async () => {
    const items = await jf.allItems({ IncludeItemTypes: 'Movie', Fields: 'ProviderIds' });
    expect(items.map((i) => i.Name).sort()).toEqual(['Elf', 'Home Alone']);
  });

  it('creates, fills, empties and deletes a collection without touching its films', async () => {
    const id = await jf.createCollection('Christmas Movies');
    await jf.addToCollection(id, ['m1', 'm2']);
    expect((await jf.collectionChildren(id)).map((c) => c.Id).sort()).toEqual(['m1', 'm2']);
    await jf.removeFromCollection(id, ['m2']);
    expect((await jf.collectionChildren(id)).map((c) => c.Id)).toEqual(['m1']);
    await jf.deleteItem(id);
    expect(fake.items.has(id)).toBe(false);
    expect(fake.items.has('m1')).toBe(true);
  });

  it('echoes LockData unchanged so a box set update never locks its films (ADR-019)', async () => {
    const id = await jf.createCollection('Christmas Movies', ['m1']);
    await jf.updateItem(id, (dto) => ({ ...dto, LockData: true, ForcedSortName: '!00_Christmas Movies', LockedFields: ['Name', 'Overview', 'Tags'] }));
    expect(fake.items.get(id)?.LockData).toBe(false);
    expect(fake.items.get('m1')?.LockData).toBe(false);
    expect(fake.items.get(id)?.LockedFields).toEqual(['Name', 'Overview', 'Tags']);
    expect(fake.items.get(id)?.SortName).toBe('!0000000000_christmas movies');
  });

  it('uploads posters as base64 text with an image content type', async () => {
    const id = await jf.createCollection('Christmas Movies');
    await jf.uploadPrimaryImage(id, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    expect(fake.items.get(id)?.images?.Primary).toBe(7);
  });

  it('signs a person in with their own credentials', async () => {
    const r = await jf.authenticateByName('admin', 'pw');
    expect(r.User?.Policy?.IsAdministrator).toBe(true);
    await expect(jf.authenticateByName('admin', 'wrong')).rejects.toThrow(/401/);
  });

  it('returns null for a missing item', async () => {
    expect(await jf.getItem('nope')).toBeNull();
  });
});
