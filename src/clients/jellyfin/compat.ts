// Which Jellyfin versions the app works with (Phase 4, ADR-030/031), and the exact API surface it relies on.
// test/jellyfin-compat.test.ts checks this surface against each version's published OpenAPI spec
// (fixtures extracted by scripts/jellyfin-api-surface.ts), so adding a call here means re-running that script.

/** Every Jellyfin endpoint the app calls, with the query parameters it sends. Plugin endpoints are separate. */
export const JELLYFIN_CALLS: { method: 'get' | 'post' | 'delete'; path: string; query?: string[] }[] = [
  { method: 'get', path: '/System/Info' },
  { method: 'get', path: '/Library/VirtualFolders' },
  { method: 'get', path: '/Users' },
  { method: 'get', path: '/Users/{userId}' },
  { method: 'post', path: '/Users/{userId}/Policy' },
  { method: 'post', path: '/Users/AuthenticateByName' },
  { method: 'get', path: '/Items', query: ['parentId', 'includeItemTypes', 'fields', 'recursive', 'collapseBoxSetItems', 'startIndex', 'limit', 'ids', 'userId'] },
  { method: 'get', path: '/Items/{itemId}', query: ['userId'] },
  { method: 'post', path: '/Items/{itemId}' },
  { method: 'delete', path: '/Items/{itemId}' },
  { method: 'post', path: '/Items/{itemId}/Images/{imageType}' },
  { method: 'post', path: '/Collections', query: ['name', 'ids', 'isLocked'] },
  { method: 'post', path: '/Collections/{collectionId}/Items', query: ['ids'] },
  { method: 'delete', path: '/Collections/{collectionId}/Items', query: ['ids'] },
  { method: 'get', path: '/Plugins' },
  { method: 'get', path: '/Plugins/{pluginId}/Configuration' },
  { method: 'post', path: '/Plugins/{pluginId}/Configuration' },
];

/** BaseItemDto properties the app reads or writes back (POST /Items/{id} sends the whole DTO; ADR-019). */
export const ITEM_PROPERTIES = [
  'Id', 'Name', 'ForcedSortName', 'SortName', 'Overview', 'Tags', 'LockData', 'LockedFields', 'ProviderIds', 'ImageTags',
  'ChildCount', 'DisplayOrder', 'SeriesId', 'ParentIndexNumber', 'IndexNumber', 'ProductionYear', 'OfficialRating', 'Genres', 'Studios', 'DateCreated', 'Type',
];
export const POLICY_PROPERTIES = ['IsAdministrator', 'BlockedTags'];
export const ENUM_VALUES: Record<string, string[]> = {
  ItemFields: ['ProviderIds', 'Genres', 'Tags', 'Studios', 'SortName', 'DateCreated', 'ParentId'],
  MetadataField: ['Name', 'Overview', 'Tags'],
  BaseItemKind: ['Movie', 'Series', 'Episode', 'BoxSet'],
  ImageType: ['Primary'],
};

/** Versions whose published API spec has the whole surface above (the compatibility test keeps this honest). */
export const API_CHECKED = ['10.10.7', '10.11.0', '10.11.8', '12.4.0'];
/** Versions the app has been run against on a real server (spikes 01–06 and the go-live server). */
export const SERVER_VERIFIED = ['12.4.0'];
export const MINIMUM = '10.10.0';

const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

export type VersionSupport = { level: 'verified' | 'checked' | 'untested' | 'unsupported'; note: string };

/** How confident we are about a server version, in words for Settings and the Dashboard. */
export function versionSupport(version: string | undefined): VersionSupport {
  if (!version) return { level: 'untested', note: 'Jellyfin didn’t report its version.' };
  const [major, minor] = parts(version);
  if (compareVersions(version, MINIMUM) < 0) return { level: 'unsupported', note: `Jellyfin ${version} is older than ${MINIMUM}, the oldest version this app supports. Please update Jellyfin.` };
  if (SERVER_VERIFIED.some((v) => parts(v)[0] === major && parts(v)[1] === minor)) return { level: 'verified', note: `Jellyfin ${version}: tested on a real server.` };
  if (API_CHECKED.some((v) => parts(v)[0] === major && parts(v)[1] === minor)) return { level: 'checked', note: `Jellyfin ${version}: every API call this app makes exists in this version’s published API, but it hasn’t been run on a real ${major}.${minor} server yet.` };
  return { level: 'untested', note: `Jellyfin ${version} is newer than the versions this app has been checked against. It will probably work; check the first dry run before approving changes.` };
}
