// SQLite schema (Drizzle). See docs/ARCHITECTURE.md §2. Timestamps are epoch milliseconds.
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
});

export const secret = sqliteTable('secret', {
  name: text('name').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  last4: text('last4').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  csrf: text('csrf').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const library = sqliteTable('library', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  collectionType: text('collection_type'),
  /** Jellyfin's "Automatically add to collection" for this library, which makes unlocked, name-identified box sets (ADR-040). */
  autoCollections: integer('auto_collections', { mode: 'boolean' }),
  /** The library's own preferred metadata language ("en"), or null to follow the server's (ADR-043). */
  preferredLanguage: text('preferred_language'),
  /** Its enabled image fetchers by item type ({ Movie: ["TheMovieDb", "Screen Grabber"] }), from LibraryOptions.TypeOptions. */
  imageFetchers: json<Record<string, string[]>>('image_fetchers'),
  seenAt: integer('seen_at').notNull(),
});

export const libraryItem = sqliteTable(
  'library_item',
  {
    jfId: text('jf_id').primaryKey(),
    kind: text('kind').$type<'movie' | 'series' | 'episode'>().notNull(),
    libraryId: text('library_id').notNull(),
    name: text('name').notNull(),
    sortName: text('sort_name'),
    year: integer('year'),
    imdb: text('imdb'),
    tmdb: text('tmdb'),
    tvdb: text('tvdb'),
    /** Films only: the TMDb collection (film series) Jellyfin's TMDb metadata says it belongs to (ADR-035). */
    tmdbCollection: text('tmdb_collection'),
    seriesJfId: text('series_jf_id'),
    season: integer('season'),
    episode: integer('episode'),
    /** Episodes only: the last episode number in a file that holds several (Jellyfin's IndexNumberEnd, "S07E13-E14"). */
    episodeEnd: integer('episode_end'),
    officialRating: text('official_rating'),
    genres: json<string[]>('genres').notNull().default([]),
    tags: json<string[]>('tags').notNull().default([]),
    studios: json<string[]>('studios').notNull().default([]),
    dateAdded: integer('date_added'),
    /** Release date (films), first air date (series) or air date (episodes), from Jellyfin's PremiereDate; ADR-037. */
    premiereDate: integer('premiere_date'),
    /** When this title first arrived, remembered across replaced files (title_added); falls back to dateAdded. ADR-038. */
    firstAdded: integer('first_added'),
    /** Series only: Jellyfin's status (Continuing, Ended), the fallback for status overlays when TMDb has none. ADR-039. */
    status: text('status'),
    /** Films and series: the current poster's tag (it changes with the poster), or null for none (ADR-043). */
    primaryTag: text('primary_tag'),
    /** Films: the file's path; series: the show's folder. For checking a TMDb ID against "Title (Year)" (ADR-043). */
    path: text('path'),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => [index('library_item_imdb').on(t.imdb), index('library_item_tmdb').on(t.tmdb), index('library_item_tvdb').on(t.tvdb), index('library_item_kind').on(t.kind), index('library_item_tmdb_collection').on(t.tmdbCollection)],
);

/**
 * Posters this app has put overlays on (ADR-039). The original is kept in /config/overlays/originals/<file> until the
 * overlays come off. appliedTag is Jellyfin's image tag after the upload (null while one is in flight); appliedHash is
 * the uploaded image's SHA-256, so the app can always tell its own image from a new poster.
 */
export const overlay = sqliteTable('overlay', {
  jfId: text('jf_id').primaryKey(),
  badges: json<string[]>('badges').notNull(),
  file: text('file').notNull(),
  contentType: text('content_type').notNull(),
  originalTag: text('original_tag'),
  appliedTag: text('applied_tag'),
  appliedHash: text('applied_hash').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * When each film or episode first arrived in the library, by a stable key (TMDb, IMDb or TVDB ID; season and episode
 * numbers for episodes), so an upgraded file, which Jellyfin may index as a new item, keeps its first date (ADR-038).
 */
export const titleAdded = sqliteTable('title_added', {
  key: text('key').primaryKey(),
  firstAdded: integer('first_added').notNull(),
  lastSeen: integer('last_seen').notNull(),
});

export const tmdbCache = sqliteTable('tmdb_cache', {
  key: text('key').primaryKey(),
  payload: json<unknown>('payload'),
  fetchedAt: integer('fetched_at').notNull(),
  ttlDays: integer('ttl_days').notNull(),
});

export type WindowDef =
  | { type: 'range'; from: string; to: string; leadDays?: number; lagDays?: number }
  | { type: 'nth_weekday'; month: number; weekday: number; nth: number; before: number; after: number }
  | { type: 'easter'; before: number; after: number };

export type Filters = {
  maxRating?: string | null;
  genresInclude?: string[];
  genresExclude?: string[];
  yearFrom?: number | null;
  yearTo?: number | null;
};

/** A collection's poster: an image address, an image uploaded to /config/posters (ADR-042), or none. */
export type Poster = { kind: 'url'; url: string } | { kind: 'file'; file: string } | { kind: 'none' };

/** A stable name for where a poster comes from: its address, or "file:<name>" for an uploaded one; null for none. */
export const posterKey = (p: Poster): string | null => (p.kind === 'url' ? p.url : p.kind === 'file' ? `file:${p.file}` : null);

export const definition = sqliteTable(
  'definition',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    target: text('target').$type<'movies' | 'shows' | 'both' | 'episodes'>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    presetKey: text('preset_key'),
    presetRev: text('preset_rev'),
    window: json<WindowDef | null>('window'),
    filters: json<Filters>('filters').notNull().default({}),
    libraryIds: json<string[] | null>('library_ids'),
    minItems: integer('min_items').notNull().default(1),
    syncMode: text('sync_mode').$type<'sync' | 'append'>().notNull().default('sync'),
    sortBy: text('sort_by').notNull().default('title.asc'),
    sortTitle: text('sort_title'),
    overview: text('overview'),
    poster: json<Poster>('poster').notNull().default({ kind: 'none' }),
    visibility: text('visibility').$type<'delete' | 'tag_gate'>().notNull().default('delete'),
    /** Phase 3 (ADR-025): show the box set as a home-screen row (Home Screen Sections + Collection Sections) while it's live. */
    homeRow: integer('home_row', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('definition_slug').on(t.slug)],
);

export const definitionSource = sqliteTable('definition_source', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  definitionId: integer('definition_id').notNull(),
  type: text('type').notNull(),
  config: json<Record<string, unknown>>('config').notNull(),
  role: text('role').$type<'add' | 'suggest'>().notNull().default('add'),
  position: integer('position').notNull().default(0),
});

/** Radarr/Sonarr per collection (ADR-027, Phase 2): send missing titles automatically, and option overrides. */
export type ArrOptions = {
  qualityProfileId?: number; rootFolderPath?: string; tags?: number[]; monitored?: boolean; searchOnAdd?: boolean;
  /** Radarr only. */ minimumAvailability?: 'announced' | 'inCinemas' | 'released';
  /** Sonarr only. */ seriesType?: 'standard' | 'anime' | 'daily'; seasonFolder?: boolean; monitor?: string;
};

export const definitionArr = sqliteTable('definition_arr', {
  definitionId: integer('definition_id').primaryKey(),
  addMissing: integer('add_missing', { mode: 'boolean' }).notNull().default(false),
  options: json<ArrOptions>('options').notNull().default({}),
});

export const definitionMode = sqliteTable(
  'definition_mode',
  {
    definitionId: integer('definition_id').notNull(),
    actionType: text('action_type').notNull(),
    mode: text('mode').$type<'off' | 'review' | 'auto'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.definitionId, t.actionType] })],
);

export const pin = sqliteTable(
  'pin',
  {
    definitionId: integer('definition_id').notNull(),
    jfId: text('jf_id').notNull(),
    kind: text('kind').$type<'pin' | 'exclude'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.definitionId, t.jfId] })],
);

export type SourceItem = {
  imdb?: string | undefined;
  tmdb?: string | undefined;
  tvdb?: string | undefined;
  kind: 'movie' | 'show' | 'episode' | 'other';
  rank: number;
  title?: string | undefined;
  year?: number | undefined;
  seriesImdb?: string | undefined;
  /** A Jellyfin item ID, for sources that read the library itself (Jellyfin queries, episode-title suggestions). */
  jf?: string | undefined;
};

export const sourceResult = sqliteTable('source_result', {
  sourceKey: text('source_key').primaryKey(),
  label: text('label').notNull(),
  status: text('status').$type<'ok' | 'stale' | 'failed'>().notNull(),
  error: text('error'),
  fetchedAt: integer('fetched_at'),
  items: json<SourceItem[] | null>('items'),
  meta: json<Record<string, unknown> | null>('meta'),
  lastGoodAt: integer('last_good_at'),
});

export type SavedMeta = { name: string; sortTitle: string | null; overview: string | null; posterUrl: string | null };

export const managedCollection = sqliteTable('managed_collection', {
  definitionId: integer('definition_id').primaryKey(),
  jfBoxsetId: text('jf_boxset_id'),
  origin: text('origin').$type<'created' | 'adopted'>().notNull(),
  /** live: visible box set · hidden: kept but gated by the blocked tag (ADR-010) · absent: no box set. */
  state: text('state').$type<'live' | 'hidden' | 'absent'>().notNull(),
  savedMeta: json<SavedMeta | null>('saved_meta'),
  /** What the app last wrote for the box set's identity and artwork, checked every run (ADR-040). */
  artwork: json<ArtworkState | null>('artwork'),
  updatedAt: integer('updated_at').notNull(),
});

/** A managed box set's expected identity: its provider IDs, and the tag of the poster the app uploaded (null: no poster). */
export type ArtworkState = {
  providerIds: Record<string, string>; posterUrl: string | null; primaryTag: string | null; at: number;
  /** The name and overview the app last wrote; anything else changing them is undone (a re-identification renames and re-describes). */
  name?: string | null; overview?: string | null;
};

/** Integrity repairs on managed box sets (ADR-040), shown on the Dashboard. */
export const integrityEvent = sqliteTable('integrity_event', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at').notNull(),
  definitionId: integer('definition_id').notNull(),
  name: text('name').notNull(),
  /** What was wrong and what was done, in words. */
  what: text('what').notNull(),
  /** False when the repair failed. */
  ok: integer('ok', { mode: 'boolean' }).notNull(),
});

export type Provenance = { sources: { key: string; label: string; rank: number }[]; match: string; pinned?: boolean };

export const membership = sqliteTable(
  'membership',
  {
    definitionId: integer('definition_id').notNull(),
    jfId: text('jf_id').notNull(),
    provenance: json<Provenance>('provenance').notNull(),
    since: integer('since').notNull(),
    actionId: integer('action_id'),
  },
  (t) => [primaryKey({ columns: [t.definitionId, t.jfId] })],
);

export const run = sqliteTable('run', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  job: text('job').notNull(),
  trigger: text('trigger').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status').$type<'running' | 'ok' | 'failed'>().notNull(),
  stats: json<Record<string, number>>('stats').notNull().default({}),
  log: text('log').notNull().default(''),
});

export type ActionType =
  | 'collection.create'
  | 'collection.delete'
  | 'collection.add_items'
  | 'collection.remove_items'
  | 'collection.update_metadata'
  | 'collection.hide'
  | 'collection.show'
  | 'radarr.add_movie'
  | 'radarr.monitor_collection'
  | 'sonarr.add_series';

export type ActionStatus = 'proposed' | 'approved' | 'applied' | 'dismissed' | 'snoozed' | 'failed' | 'superseded';

export const action = sqliteTable(
  'action',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id'),
    type: text('type').$type<ActionType>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    definitionId: integer('definition_id'),
    item: json<{ jfId?: string; name?: string; year?: number | null; provenance?: Provenance } | null>('item'),
    payload: json<Record<string, unknown> | null>('payload'),
    mode: text('mode').$type<'review' | 'auto'>().notNull(),
    reason: text('reason'),
    status: text('status').$type<ActionStatus>().notNull(),
    applyAt: integer('apply_at'),
    before: json<unknown>('before'),
    after: json<unknown>('after'),
    undoOf: integer('undo_of'),
    decidedBy: text('decided_by'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    decidedAt: integer('decided_at'),
    appliedAt: integer('applied_at'),
  },
  (t) => [index('action_fingerprint').on(t.fingerprint), index('action_status').on(t.status)],
);

export const decision = sqliteTable('decision', {
  fingerprint: text('fingerprint').primaryKey(),
  kind: text('kind').$type<'dismiss' | 'snooze'>().notNull(),
  until: integer('until'),
  decidedBy: text('decided_by'),
  createdAt: integer('created_at').notNull(),
});

export const jobSchedule = sqliteTable('job_schedule', {
  job: text('job').primaryKey(),
  cron: text('cron').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: integer('last_run_at'),
});

export const imdbHash = sqliteTable('imdb_hash', {
  name: text('name').primaryKey(),
  value: text('value'),
  lastGood: text('last_good'),
  checkedAt: integer('checked_at'),
  error: text('error'),
});

/** Access tokens for the MCP endpoint (ADR-032). Only a SHA-256 hash is stored; the token is shown once. */
export const apiToken = sqliteTable(
  'api_token',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    hash: text('hash').notNull(),
    hint: text('hint').notNull(),
    scope: text('scope').$type<'read' | 'review' | 'full'>().notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [uniqueIndex('api_token_hash').on(t.hash)],
);

/**
 * Library health (ADR-041): each film's and episode's file as Jellyfin probed it. sig changes when the file does (its
 * DateCreated), so a replaced file is checked again.
 */
export const mediaCheck = sqliteTable('media_check', {
  jfId: text('jf_id').primaryKey(),
  sig: text('sig').notNull(),
  /** The file's own duration, in minutes. */
  durationMin: real('duration_min'),
  /** Title tags on its video, audio and subtitle streams. */
  titles: json<string[]>('titles').notNull().default([]),
  path: text('path'),
  checkedAt: integer('checked_at').notNull(),
  /** What the probe read: 1 (0.13), 2 (0.17: audio tracks and embedded pictures too). Older rows are probed again. */
  probeV: integer('probe_v').notNull().default(1),
  /** Audio tracks: language (as tagged), whether it's the default, and its title (ADR-043). */
  audio: json<{ lang: string | null; isDefault: boolean; title: string | null }[]>('audio'),
  /** A picture embedded in the file (an embedded image stream's size, or an image attachment), if any. */
  embeddedImage: json<{ w: number | null; h: number | null; via: 'stream' | 'attachment' }>('embedded_image'),
  /** Whether Jellyfin has trickplay previews of it (for a frame from the middle, ADR-044). Probe 3. */
  trickplay: integer('trickplay', { mode: 'boolean' }),
  /** The file's own (container) title, read from the media mount (ADR-044). */
  containerTitle: text('container_title'),
  /** 0: not read yet; 1: read (the title may be none); 2: couldn't be read from the mount. */
  containerRead: integer('container_read').notNull().default(0),
});

/** What a Library health finding is about (ADR-041, ADR-043). */
export type HealthKind = 'runtime' | 'title' | 'audio' | 'no_poster' | 'video_poster' | 'language' | 'other_title';
export const ARTWORK_KINDS = ['no_poster', 'video_poster', 'language', 'other_title'] as const;
export type ArtworkKind = (typeof ARTWORK_KINDS)[number];
/** A TMDb image the app would put on instead: its file path on TMDb, language and size. */
export type ArtworkProposal = { tmdb: string; media: 'movie' | 'tv'; path: string; lang: string | null; w: number; h: number };

/** A file that may not be what it says (ADR-041), or artwork or audio that may be wrong (ADR-043). */
export const healthFinding = sqliteTable(
  'health_finding',
  {
    jfId: text('jf_id').notNull(),
    kind: text('kind').$type<HealthKind>().notNull(),
    detail: text('detail').notNull(),
    /** The file's sig when found: a dismissal lasts until the file changes. */
    sig: text('sig').notNull(),
    firstSeen: integer('first_seen').notNull(),
    dismissedAt: integer('dismissed_at'),
    dismissedBy: text('dismissed_by'),
    /** Artwork findings: the TMDb poster the fix would put on, when there's a verified TMDb ID to take it from. */
    proposal: json<ArtworkProposal>('proposal'),
    /** For what isn't in the library index (a box set): its name and kind, for display. */
    subject: json<{ name: string; kind: 'boxset' }>('subject'),
  },
  (t) => [primaryKey({ columns: [t.jfId, t.kind] })],
);

/** Each film's and show's artwork as last checked (ADR-043): checked again when its poster or IDs change, or monthly. */
export const artworkCheck = sqliteTable('artwork_check', {
  jfId: text('jf_id').primaryKey(),
  /** The poster tag and IDs it was checked with. */
  sig: text('sig').notNull(),
  checkedAt: integer('checked_at').notNull(),
  /** The TMDb ID the artwork may be taken from, and how it was confirmed; null when it couldn't be. */
  verifiedTmdb: text('verified_tmdb'),
  verifiedBy: text('verified_by').$type<'imdb' | 'tvdb' | 'path'>(),
  /** What the poster is: one of TMDb's for this title (and its language), none, a video frame, or not known. */
  poster: json<{ source: 'tmdb' | 'none' | 'frame' | 'unknown'; lang?: string | null; path?: string | null; aspect?: number | null; /** TMDb's poster in the library's language that is the same picture. */ sameAs?: string | null }>('poster'),
  /** Anything worth saying that isn't a finding ("TMDb has no English poster for this title"). */
  note: text('note'),
});

/** A TMDb image's fingerprint (a 64-bit difference hash), by its file path, which never changes. */
export const imageHash = sqliteTable('image_hash', {
  path: text('path').primaryKey(),
  hash: text('hash').notNull(),
});

/** Artwork the app replaced from TMDb, with the old images backed up so it can be undone (ADR-043). */
export const artworkFix = sqliteTable('artwork_fix', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at').notNull(),
  jfId: text('jf_id').notNull(),
  title: text('title').notNull(),
  /** The finding it fixed. */
  kind: text('kind').$type<ArtworkKind>().notNull(),
  /** Who: a user's name, "Claude (token)", or "automatic". */
  by: text('by').notNull(),
  tmdb: text('tmdb').notNull(),
  /** What it put on, in words. */
  what: text('what').notNull(),
  /** For each image type replaced, the backed-up files (under /config/artwork/backups), or [] if there was none. */
  backups: json<Record<string, string[]>>('backups').notNull(),
  undoneAt: integer('undone_at'),
  undoneBy: text('undone_by'),
});
