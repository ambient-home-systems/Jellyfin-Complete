// The words the pages use (ADR-046). The engine's names stay in code and in the MCP endpoint; people read these.
// One place, so a label can't drift between Home, the Inbox, a collection and Settings.
import type { ActionType } from '../db/schema.js';
import type { Mode, Settings } from '../settings.js';
import { localDay } from '../domain/windows.js';
import type { PresetFamily } from '../presets/index.js';

/** Approval: whether a kind of change happens by itself, waits for you, or never happens. */
export const MODE_LABEL: Record<Mode, string> = { off: 'Never', review: 'Ask me', auto: 'Automatic' };
export const MODE_OPTIONS: [string, string][] = [['off', MODE_LABEL.off], ['review', MODE_LABEL.review], ['auto', MODE_LABEL.auto]];

/** The kinds of change that have an approval setting of their own. */
export const APPROVAL_ROWS: [ActionType, string][] = [
  ['collection.create', 'Create and remove collections in Jellyfin'],
  ['collection.add_items', 'Add titles'],
  ['collection.remove_items', 'Remove titles'],
  ['collection.update_metadata', 'Update name, poster and description'],
  ['radarr.add_movie', 'Send a movie to Radarr'],
  ['sonarr.add_series', 'Send a show to Sonarr'],
  ['radarr.monitor_collection', 'Monitor a TMDb collection in Radarr'],
];
/** The four a single collection can override. */
export const COLLECTION_APPROVAL_ROWS = APPROVAL_ROWS.slice(0, 4);

/** A change waiting in the Inbox, as a heading. */
export const CHANGE_LABEL: Record<string, string> = {
  'collection.create': 'Create in Jellyfin',
  'collection.delete': 'Remove from Jellyfin',
  'collection.add_items': 'Add titles',
  'collection.remove_items': 'Remove titles',
  'collection.update_metadata': 'Update name, poster and description',
  'collection.hide': 'Hide in Jellyfin',
  'collection.show': 'Show in Jellyfin',
  'radarr.add_movie': 'Send to Radarr',
  'sonarr.add_series': 'Send to Sonarr',
  'radarr.monitor_collection': 'Monitor in Radarr',
};
/** The same change as one word, beside a title. */
export const CHANGE_VERB: Record<string, string> = {
  'collection.create': 'Create', 'collection.delete': 'Remove', 'collection.add_items': 'Add', 'collection.remove_items': 'Remove',
  'collection.update_metadata': 'Update', 'collection.hide': 'Hide', 'collection.show': 'Show',
  'radarr.add_movie': 'Radarr', 'sonarr.add_series': 'Sonarr', 'radarr.monitor_collection': 'Monitor',
};
/** A change that takes something away, for the minus sign. */
export const TAKES_AWAY = new Set(['collection.remove_items', 'collection.delete', 'collection.hide']);
/** A change already made, in History. */
export const DONE_LABEL: Record<string, string> = {
  'collection.create': 'Created in Jellyfin', 'collection.delete': 'Removed from Jellyfin', 'collection.add_items': 'Added',
  'collection.remove_items': 'Removed', 'collection.update_metadata': 'Updated name, poster or description',
  'collection.hide': 'Hid in Jellyfin', 'collection.show': 'Showed in Jellyfin',
  'radarr.add_movie': 'Sent to Radarr', 'sonarr.add_series': 'Sent to Sonarr', 'radarr.monitor_collection': 'Monitored in Radarr',
};

/** A collection's dates beginning and ending. */
export const DATE_CHANGE: Record<'opens' | 'closes', string> = { opens: 'appears', closes: 'goes away' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12/26" → "26 Dec", the way every other date on the pages reads. */
export function monthDay(md: string): string {
  const m = md.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return md;
  return `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? m[1]}`;
}
/** A collection's dates in a few words. */
export function datesLabel(w: { type: string; from?: string; to?: string } | null | undefined): string {
  if (!w) return 'All year';
  if (w.type === 'range' && w.from && w.to) return `${monthDay(w.from)} – ${monthDay(w.to)}`;
  return 'Moves each year';
}

/** "today at 02:30", "tomorrow at 02:30", or the day. */
export function whenNext(at: number | null | undefined, tz: string, now = Date.now()): string | null {
  if (!at) return null;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));
  const days = localDay(at, tz) - localDay(now, tz);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(at))} at ${time}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** A cron expression in words, for the common shapes ("30 2 * * *" → "Every day at 02:30"); null for anything else. */
export function describeCron(cron: string): string | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, dom, mon, dow] = p as [string, string, string, string, string];
  if (mon !== '*') return null;
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && dow === '*') return `Every hour at ${min.padStart(2, '0')} minutes past`;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
  const t = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && dow === '*') return `Every day at ${t}`;
  if (dom === '*' && /^[0-7]$/.test(dow)) return `Every ${DAYS[Number(dow) % 7]} at ${t}`;
  if (/^\d+$/.test(dom) && dow === '*') return `On day ${dom} of each month at ${t}`;
  return null;
}

/** Every timezone the server knows, with the one in use even if it's an alias the list leaves out. */
export function timezoneOptions(current: string): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    all = [];
  }
  return [...new Set([current, 'UTC', ...all].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * What each family of ready-made collections is, in a sentence. The count is how many collections the family can make,
 * not how many titles were found in Jellyfin.
 */
export function familyNote(family: PresetFamily, n: number, s: Settings): string {
  switch (family) {
    case 'seasonal': return `${n} movie collections for holidays and awareness months (Christmas, Halloween, Black History Month…). Each appears only during its dates.`;
    case 'holiday_episodes': return `${n} collections of Christmas, Halloween and Thanksgiving episodes from your shows, on the same dates as the movies.`;
    case 'universe': return `${n} movie universes (Marvel, Star Wars, Middle Earth…), one collection each. A universe’s collection is made only when you have at least 2 of its movies, and stays all year.`;
    case 'show_franchise': return `${n} TV franchises (Star Trek, NCIS, One Chicago…), one collection each. A franchise’s collection is made only when you have at least 2 of its shows, and stays all year.`;
    case 'film_series': return `One collection for each movie series you have at least ${s.filmSeries.minimum} movies of (Toy Story, John Wick…), named and illustrated from TMDb, in release order. New series appear as you add movies.${n ? ` ${n} so far.` : ''} Needs a TMDb key.`;
    case 'basic': return `${n} collections that follow your library: Newly Released Movies and Shows (the last 90 days), New Episodes (aired in the last 7 days), and Recently Added Movies and Shows (the last 30 days). They change every night.`;
    case 'imdb_chart': return `${n} collections of the titles you own from IMDb’s charts: the Top 250 and Most Popular movies and shows, and the Lowest Rated movies. They follow the charts and stay all year.`;
    case 'streaming': return `${n} collections of the titles you own that stream on a service in your country (${s.streaming.region}; change it in Settings): Netflix Movies, Disney+ Shows and so on. Turning this on turns on the services offered there. Needs a TMDb key; a big library fills in over a few nights.`;
  }
}
