// Spikes 1a + 1b — WRITES TO JELLYFIN. Runs only with --i-approve-writes.
// Everything it creates is named zz-test-* and is deleted in the finally block, even on failure.
//  1. Box set holding 2 movies + 1 episode   (can a box set hold episodes?)
//  2. ForcedSortName "!00_zz-test …"         (does Kometa's "!" prefix survive sort-name normalising?)
//  3. LockedFields + poster upload (base64)  (metadata calls the app will make)
//  4. Tag-gate: tag the box set, block the tag for a throwaway user, then look as that user
//  5. Public playlist with the episode       (fallback container for holiday episodes)
import { loadEnv, need, jf, http, report, save, sleep } from './lib.mjs';

loadEnv(); need('JELLYFIN_URL', 'JELLYFIN_API_KEY');
const PLAN = 'Creates zz-test-taggate (user), zz-test-Collection (box set), zz-test-Episodes (playlist); edits only those; deletes all three at the end.';
if (!process.argv.includes('--i-approve-writes')) { console.log(`Dry run. ${PLAN}\nRe-run with --i-approve-writes once the owner has approved this write.`); process.exit(0); }

const { base, call } = jf();
const results = { startedAt: new Date().toISOString() };
const created = {};
const step = async (name, fn) => { try { results[name] = await fn(); } catch (e) { results[name] = { error: e.message }; } report(name, results[name]); };

const users = (await call('/Users')).json || [];
const admin = users.find((u) => u.Policy?.IsAdministrator);
if (!admin) { console.error('No administrator user found.'); process.exit(1); }
const pick = async (type) => (await call(`/Items?${new URLSearchParams({ userId: admin.Id, Recursive: 'true', IncludeItemTypes: type, HasImdbId: 'true', SortBy: 'SortName', Limit: '2', Fields: 'ProviderIds', CollapseBoxSetItems: 'false' })}`)).json?.Items || [];
const [m1, m2] = await pick('Movie');
const [ep] = await pick('Episode');
if (!m1 || !m2 || !ep) { console.error('Need at least 2 movies and 1 episode with IMDb IDs.'); process.exit(1); }
const getItem = async (id, userId = admin.Id) => (await call(`/Items/${id}?userId=${userId}`)).json || (await call(`/Users/${userId}/Items/${id}`)).json;

try {
  await step('1 box set with episodes', async () => {
    const r = await call(`/Collections?${new URLSearchParams({ name: 'zz-test-Collection', ids: [m1.Id, m2.Id, ep.Id].join(','), isLocked: 'false' })}`, { method: 'POST' });
    if (!r.ok) throw new Error(`create HTTP ${r.status}`);
    created.boxset = r.json.Id; await sleep(1500);
    const kids = (await call(`/Items?${new URLSearchParams({ userId: admin.Id, ParentId: created.boxset, Fields: 'ProviderIds' })}`)).json?.Items || [];
    return { created: true, children: kids.map((k) => `${k.Type}: ${k.Name}`), episodeIncluded: kids.some((k) => k.Type === 'Episode') };
  });

  await step('2 sort title + 3 locked fields', async () => {
    const dto = await getItem(created.boxset);
    const before = { LockData: dto.LockData, LockedFields: dto.LockedFields };
    const body = { ...dto, ForcedSortName: '!00_zz-test Collection', Overview: 'zz-test overview', Tags: [...(dto.Tags || []), 'zz-test-hidden'], LockedFields: ['Name', 'Overview', 'Tags'], LockData: dto.LockData, DisplayOrder: 'SortName' };
    const r = await call(`/Items/${created.boxset}`, { method: 'POST', body });
    const after = await getItem(created.boxset);
    const child = await getItem(m1.Id);
    return { updateStatus: r.status, before, forcedSortName: after.ForcedSortName, sortName: after.SortName, tags: after.Tags, lockedFields: after.LockedFields, lockData: after.LockData, displayOrder: after.DisplayOrder, childStillUnlocked: child.LockData === false || child.LockData === undefined };
  });

  await step('3 poster upload (base64 body)', async () => {
    const img = await fetch('https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/seasonal/christmas.jpg');
    const b64 = Buffer.from(await img.arrayBuffer()).toString('base64');
    const r = await http(`${base}/Items/${created.boxset}/Images/Primary`, { method: 'POST', raw: true, body: b64, headers: { 'content-type': 'image/jpeg', authorization: `MediaBrowser Token="${process.env.JELLYFIN_API_KEY}"` } });
    const images = (await call(`/Items/${created.boxset}/Images`)).json || [];
    return { status: r.status, primaryImagePresent: images.some((i) => i.ImageType === 'Primary') };
  });

  await step('4 tag-gate', async () => {
    const pw = `zz-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const u = await call('/Users/New', { method: 'POST', body: { Name: 'zz-test-taggate', Password: pw } });
    if (!u.ok) throw new Error(`create user HTTP ${u.status}`);
    created.user = u.json.Id;
    const policy = (await call(`/Users/${created.user}`)).json.Policy;
    const open = await call(`/Users/${created.user}/Policy`, { method: 'POST', body: { ...policy, EnableAllFolders: true } });
    const auth = await http(`${base}/Users/AuthenticateByName`, { method: 'POST', body: { Username: 'zz-test-taggate', Pw: pw }, headers: { authorization: 'MediaBrowser Client="maverick-spike", Device="spike", DeviceId="maverick-spike-taggate", Version="0.1"' } });
    const token = auth.json?.AccessToken; created.token = token;
    const asUser = (path) => http(base + path, { headers: { authorization: `MediaBrowser Token="${token}"` } });
    const listed = async () => ((await asUser(`/Items?${new URLSearchParams({ userId: created.user, Recursive: 'true', IncludeItemTypes: 'BoxSet' })}`)).json?.Items || []).some((b) => b.Id === created.boxset);
    // Control: the test user must see the box set before the tag is blocked, or a later "hidden" proves nothing.
    const visibleBeforeGate = await listed();
    const gate = await call(`/Users/${created.user}/Policy`, { method: 'POST', body: { ...policy, EnableAllFolders: true, BlockedTags: ['zz-test-hidden'] } });
    await sleep(500);
    const visibleAfterGate = await listed();
    const direct = await asUser(`/Items/${created.boxset}?userId=${created.user}`);
    const visible = (await asUser(`/Items?${new URLSearchParams({ userId: created.user, Ids: [m1.Id, m2.Id, ep.Id].join(',') })}`)).json?.Items || [];
    const moviesView = (await asUser(`/Items?${new URLSearchParams({ userId: created.user, Recursive: 'true', IncludeItemTypes: 'Movie', SearchTerm: m1.Name.slice(0, 20) })}`)).json?.Items || [];
    // The app talks to Jellyfin with an API key, not as a user: it must still be able to read the gated box set.
    const apiKeyCanRead = (await call(`/Items/${created.boxset}?userId=${admin.Id}`)).ok;
    return {
      policyUpdates: [open.status, gate.status], signedInAsTestUser: Boolean(token),
      boxSetVisibleBeforeGate: visibleBeforeGate, boxSetVisibleAfterGate: visibleAfterGate, boxSetDirectFetchStatus: direct.status,
      childrenVisibleToUser: visible.map((v) => `${v.Type}: ${v.Name}`), firstMovieInLibrarySearch: moviesView.some((v) => v.Id === m1.Id),
      apiKeyCanStillReadBoxSet: apiKeyCanRead,
      verdict: !visibleBeforeGate ? 'INCONCLUSIVE: the test user could not see the box set even before the gate'
        : !visibleAfterGate && visible.length === 3 ? 'WORKS: box set hidden, items visible' : 'DOES NOT behave as hoped; see fields',
    };
  });

  await step('5 public playlist with an episode', async () => {
    const r = await call('/Playlists', { method: 'POST', body: { Name: 'zz-test-Episodes', Ids: [ep.Id], UserId: admin.Id, MediaType: 'Video', IsPublic: true } });
    if (!r.ok) throw new Error(`create playlist HTTP ${r.status}`);
    created.playlist = r.json.Id; await sleep(1000);
    const seen = created.token ? (await http(`${base}/Items?${new URLSearchParams({ userId: created.user, Recursive: 'true', IncludeItemTypes: 'Playlist' })}`, { headers: { authorization: `MediaBrowser Token="${created.token}"` } })).json?.Items || [] : null;
    return { created: true, status: r.status, visibleToOtherUser: seen ? seen.some((x) => x.Id === created.playlist) : 'not checked (tag-gate step failed before sign-in)' };
  });
} finally {
  const cleanup = {};
  if (created.playlist) cleanup.playlist = (await call(`/Items/${created.playlist}`, { method: 'DELETE' })).status;
  if (created.boxset) cleanup.boxset = (await call(`/Items/${created.boxset}`, { method: 'DELETE' })).status;
  if (created.user) cleanup.user = (await call(`/Users/${created.user}`, { method: 'DELETE' })).status;
  const survivors = await Promise.all([m1, m2, ep].map(async (i) => (await call(`/Items?${new URLSearchParams({ userId: admin.Id, Ids: i.Id })}`)).json?.Items?.length === 1));
  cleanup.linkedItemsStillInLibrary = survivors.every(Boolean);
  results.cleanup = cleanup; report('cleanup', cleanup);
  save('jellyfin-writes.json', results);
}
