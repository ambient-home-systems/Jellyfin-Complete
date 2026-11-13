// SQLite schema (Drizzle). See docs/ARCHITECTURE.md §2. Timestamps are epoch milliseconds.
import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    seriesJfId: text('series_jf_id'),
    season: integer('season'),
    episode: integer('episode'),
    officialRating: text('official_rating'),
    genres: json<string[]>('genres').notNull().default([]),
    tags: json<string[]>('tags').notNull().default([]),
    studios: json<string[]>('studios').notNull().default([]),
    dateAdded: integer('date_added'),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => [index('library_item_imdb').on(t.imdb), index('library_item_tmdb').on(t.tmdb), index('library_item_tvdb').on(t.tvdb), index('library_item_kind').on(t.kind)],
);

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

export type Poster = { kind: 'url'; url: string } | { kind: 'none' };

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
  updatedAt: integer('updated_at').notNull(),
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
