/** @jsxImportSource hono/jsx */
// Settings, one page per subject (ADR-046): Connections, Libraries and region, Approvals, Schedule, Extras, Advanced.
import type { Child, FC } from 'hono/jsx';
import { Icon, Csrf, Seg, fmtDate, fmtTime } from '../ui.js';
import type { Settings } from '../../settings.js';
import type { SecretName } from '../../secrets.js';
import { JOBS } from '../../jobs/schedules.js';
import { ClaudeAccess, type Reveal } from './claude-access.js';
import type { ApiToken } from '../api-tokens.js';
import type { MediaStatus } from '../../library/media.js';
import { APPROVAL_ROWS, MODE_OPTIONS, describeCron, timezoneOptions } from '../terms.js';

export type ConnRow = { key: string; name: string; urlField?: keyof Settings['connections']; secret?: SecretName; secretLabel: string; note?: string; what: string; optional?: boolean };
export const CONNECTIONS: ConnRow[] = [
  { key: 'jellyfin', name: 'Jellyfin', urlField: 'jellyfinUrl', secret: 'jellyfin.apiKey', secretLabel: 'API key', what: 'Your server' },
  { key: 'tmdb', name: 'TMDb', secret: 'tmdb.apiKey', secretLabel: 'API key', note: 'Free key from themoviedb.org (Settings → API)', what: 'Recommended: movie series, streaming services, better matching' },
  { key: 'mdblist', name: 'MDBList', secret: 'mdblist.apiKey', secretLabel: 'API key', note: 'Public lists work without a key', what: 'Optional: private lists', optional: true },
  { key: 'plex', name: 'Plex', urlField: 'plexUrl', secret: 'plex.token', secretLabel: 'Token', what: 'Optional: compare collections with Plex. Read-only', optional: true },
  { key: 'radarr', name: 'Radarr', urlField: 'radarrUrl', secret: 'radarr.apiKey', secretLabel: 'API key', what: 'Optional: send missing movies', optional: true },
  { key: 'sonarr', name: 'Sonarr', urlField: 'sonarrUrl', secret: 'sonarr.apiKey', secretLabel: 'API key', what: 'Optional: send missing shows', optional: true },
];

export type SettingsTab = 'connections' | 'libraries' | 'approvals' | 'schedule' | 'extras' | 'advanced';
const TABS: [SettingsTab, string, string][] = [
  ['connections', '/settings', 'Connections'],
  ['libraries', '/settings/libraries', 'Libraries and region'],
  ['approvals', '/settings/approvals', 'Approvals'],
  ['schedule', '/settings/schedule', 'Schedule'],
  ['extras', '/settings/extras', 'Extras'],
  ['advanced', '/settings/advanced', 'Advanced'],
];

const Shell: FC<{ at: SettingsTab; children?: Child }> = ({ at, children }) => (
  <>
    <header class="top"><h1>Settings</h1></header>
    <div class="content">
      <div class="settings">
        <nav class="subnav" aria-label="Settings">
          {TABS.map(([key, href, label]) => <a href={href} aria-current={key === at ? 'page' : undefined}>{label}</a>)}
        </nav>
        <div class="settings-page">{children}</div>
      </div>
    </div>
  </>
);

type Masked = Record<string, { set: boolean; last4: string | null }>;
type Lib = { id: string; name: string; collectionType: string | null };

export const SettingsConnections: FC<{ s: Settings; csrf: string; masked: Masked }> = ({ s, csrf, masked }) => (
  <Shell at="connections">
    <section class="form-sec" id="conn" aria-labelledby="conn-h">
      <div class="section-head"><h2 id="conn-h">Connections</h2><span class="aside">Keys are stored encrypted and never shown again</span></div>
      <p class="muted">Only Jellyfin is needed. Each of the others switches on something extra.</p>
      <form method="post" action="/settings/connections">
        <Csrf token={csrf} />
        {CONNECTIONS.map((c) => (
          <div class="conn">
            <span class="nm">{c.name}<small>{c.what}</small></span>
            {c.urlField ? <input class="url" type="url" name={`url:${c.key}`} value={s.connections[c.urlField]} placeholder="http://your-server:port" aria-label={`${c.name} address`} /> : <span class="note">{c.note}</span>}
            <input type="password" name={`secret:${c.key}`} autocomplete="off" placeholder={masked[c.key]?.set ? `•••• ${masked[c.key]?.last4 ?? ''} (leave empty to keep)` : c.optional ? `${c.secretLabel} (optional)` : c.secretLabel} aria-label={`${c.name} ${c.secretLabel}`} />
            <button class="btn sm" type="button" hx-post={`/settings/test/${c.key}`} hx-target={`#st-${c.key}`} hx-swap="innerHTML">Test</button>
            <span class="st" id={`st-${c.key}`}>{masked[c.key]?.set ? <><span class="dot ok"></span> Key saved</> : c.optional || c.key === 'tmdb' ? <span class="faint">Not set</span> : <><span class="dot err"></span> Needed</>}</span>
          </div>
        ))}
        <div class="save-row"><button class="btn primary" type="submit">Save connections</button></div>
        <p class="hint">Test tries what you’ve typed without saving it. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </form>
    </section>
  </Shell>
);

export const SettingsLibraries: FC<{ s: Settings; csrf: string; libraries: Lib[]; libError?: string | null }> = ({ s, csrf, libraries, libError }) => {
  const movies = libraries.filter((l) => l.collectionType === 'movies');
  const shows = libraries.filter((l) => l.collectionType === 'tvshows');
  return (
    <Shell at="libraries">
      <form method="post" action="/settings/libraries" class="form">
        <Csrf token={csrf} /><input type="hidden" name="regionForm" value="1" />
        <section class="form-sec" id="libs" aria-labelledby="libs-h">
          <div class="section-head"><h2 id="libs-h">Libraries</h2><span class="aside">where collections take their titles from</span></div>
          {movies.length === 0
            ? <p class="muted">{libError ? `Couldn’t read your libraries from Jellyfin (${libError}). Until you choose, every movie library is used.` : 'Jellyfin reports no movie libraries.'}</p>
            : null}
          {movies.length ? (
            <fieldset class="plain"><legend class="label">Movies come from</legend>
              <div class="checks">
                {movies.map((l) => <label class="check"><input type="checkbox" name="movieLibraryIds" value={l.id} checked={!s.movieLibraryIds || s.movieLibraryIds.includes(l.id)} /> {l.name}</label>)}
              </div>
            </fieldset>
          ) : null}
          {shows.length ? (
            <fieldset class="plain"><legend class="label">Shows and episodes come from</legend>
              <div class="checks">
                {shows.map((l) => <label class="check"><input type="checkbox" name="showLibraryIds" value={l.id} checked={!s.showLibraryIds || s.showLibraryIds.includes(l.id)} /> {l.name}</label>)}
              </div>
            </fieldset>
          ) : null}
        </section>
        <section class="form-sec" id="region" aria-labelledby="region-h">
          <div class="section-head"><h2 id="region-h">Region</h2></div>
          <div class="grid2">
            <div class="field"><label for="tz">Timezone</label>
              <select id="tz" name="timezone">{timezoneOptions(s.timezone).map((z) => <option value={z} selected={z === s.timezone}>{z.replace(/_/g, ' ')}</option>)}</select>
              <span class="hint">Seasonal collections appear and go away at midnight here.</span></div>
            <div class="field"><label for="region">Streaming country</label><input id="region" name="streamingRegion" type="text" value={s.streaming.region} maxlength={2} pattern="[A-Za-z]{2}" class="num" autocomplete="off" /><span class="hint">Two letters, such as US, GB or CA. Streaming-service collections count the services offered there. Streaming data from JustWatch, through TMDb.</span></div>
          </div>
        </section>
        <div class="save-row"><button class="btn primary" type="submit">Save</button></div>
      </form>
    </Shell>
  );
};

export const SettingsApprovals: FC<{ s: Settings; csrf: string }> = ({ s, csrf }) => (
  <Shell at="approvals">
    <form method="post" action="/settings/approvals" class="form">
      <Csrf token={csrf} />
      <section class="form-sec" id="approve" aria-labelledby="approve-h">
        <div class="section-head"><h2 id="approve-h">Approvals</h2><span class="aside">what the app may do without asking</span></div>
        <div class="choice" role="radiogroup" aria-labelledby="approve-h">
          <label><input type="radio" name="dryRun" value="1" checked={s.dryRun} /><b>Approve everything first</b><span>Every change waits in your Inbox, whatever is set below. This is how the app starts, and the safe way to see what it would do.</span></label>
          <label><input type="radio" name="dryRun" value="0" checked={!s.dryRun} /><b>Follow the settings below</b><span>Changes set to Automatic happen on their own, changes set to Ask me wait in your Inbox, and changes set to Never don’t happen.</span></label>
        </div>
      </section>
      <section class="form-sec" id="modes" aria-labelledby="modes-h">
        <div class="section-head"><h2 id="modes-h">For each kind of change</h2><span class="aside">a collection can have its own, under its Advanced tab</span></div>
        {s.dryRun ? <p class="muted">These take effect once you choose “Follow the settings below”. Until then everything asks first.</p> : null}
        <table class="modes">
          <thead><tr><th scope="col">Change</th><th scope="col">Approval</th></tr></thead>
          <tbody>
            {APPROVAL_ROWS.map(([t, label]) => (
              <tr><td>{label}</td><td><Seg name={`mode:${t}`} value={s.modes[t]} options={MODE_OPTIONS} label={label} /></td></tr>
            ))}
          </tbody>
        </table>
        <p class="hint">Whatever is set here, a list that stops answering never empties a collection, and every change that’s made can be undone from History.</p>
      </section>
      <section class="form-sec" id="limits" aria-labelledby="limits-h">
        <div class="section-head"><h2 id="limits-h">Timing and limits</h2></div>
        <div class="grid3">
          <div class="field"><label for="lead">Plan ahead</label><input id="lead" name="leadDays" type="number" min={0} max={60} value={String(s.leadDays)} class="num" /><span class="hint">Days before a collection appears that its changes reach your Inbox.</span></div>
          <div class="field"><label for="snooze">Snooze lasts</label><select id="snooze" name="defaultSnooze">{[['window', 'Until the collection appears'], ['7d', '7 days'], ['30d', '30 days']].map(([v, l]) => <option value={v} selected={s.defaultSnooze === v}>{l}</option>)}</select><span class="hint">When you snooze one change from its row.</span></div>
          <div class="field"><label for="cap">Radarr and Sonarr sends per run</label><input id="cap" name="arrCapPerRun" type="number" min={0} max={200} value={String(s.guardrails.arrCapPerRun)} class="num" /><span class="hint">The most titles sent automatically in one run. Any more wait in your Inbox.</span></div>
        </div>
        <div class="field"><span class="label">Before sending anything to Radarr or Sonarr</span>
          <label class="check"><input type="checkbox" name="releasedOnly" value="1" checked={s.guardrails.releasedOnly} /> Only send titles that are already released</label>
          <span class="hint">Titles they already have, or that you’ve excluded there, are always skipped.</span>
        </div>
      </section>
      <div class="save-row"><button class="btn primary" type="submit">Save</button></div>
    </form>
  </Shell>
);

export const SettingsSchedule: FC<{ s: Settings; csrf: string; schedules: { job: string; cron: string; enabled: boolean; next: Date | null }[] }> = ({ s, csrf, schedules }) => (
  <Shell at="schedule">
    <form method="post" action="/settings/schedules" class="form">
      <Csrf token={csrf} /><input type="hidden" name="neighboursForm" value="1" />
      <section class="form-sec" id="sched" aria-labelledby="sched-h">
        <div class="section-head"><h2 id="sched-h">Schedule</h2><span class="aside">times in {s.timezone.replace(/_/g, ' ')}</span></div>
        <div class="table-wrap">
          <table class="tt">
            <thead><tr><th scope="col">What runs</th><th scope="col">When</th><th scope="col">On</th><th scope="col">Next</th></tr></thead>
            <tbody>
              {schedules.map((j) => {
                const job = JOBS[j.job as keyof typeof JOBS];
                return (
                  <tr>
                    <td><b>{job?.label ?? j.job}</b><br /><span class="faint">{job?.detail}</span></td>
                    <td>
                      <b>{describeCron(j.cron) ?? 'Custom schedule'}</b>
                      <details class="how"><summary>Change</summary>
                        <input type="text" name={`cron:${j.job}`} value={j.cron} aria-label={`${job?.label ?? j.job}: schedule, as a cron expression`} class="num cron" />
                        <span class="hint">Minute, hour, day of month, month, day of week. <code>30 2 * * *</code> is every day at 02:30; <code>10 3 * * 0</code> is Sundays at 03:10.</span>
                      </details>
                    </td>
                    <td><input type="checkbox" name={`on:${j.job}`} value="1" checked={j.enabled} aria-label={`${job?.label ?? j.job} on`} /></td>
                    <td class="num">{j.next ? `${fmtDate(j.next.getTime(), s.timezone)} ${fmtTime(j.next.getTime(), s.timezone)}` : '—'}</td>
                  </tr>
                );
              })}
              {s.neighbours.map((n) => <tr><td class="faint">{n.name}</td><td class="faint">{n.time}</td><td colspan={2} class="faint">another tool</td></tr>)}
            </tbody>
          </table>
        </div>
        <div class="field"><label for="nb">Other tools’ times</label><textarea id="nb" name="neighbours" rows={3} placeholder={'Jellyfin-Auto-Collections 04:00\nKometa (Plex) 05:00'}>{s.neighbours.map((n) => `${n.name} ${n.time}`).join('\n')}</textarea><span class="hint">Optional. One per line, a name then a time. They’re only shown in the table above, so you can keep this app’s runs clear of them.</span></div>
      </section>
      <div class="save-row"><button class="btn primary" type="submit">Save</button></div>
    </form>
  </Shell>
);

export const SettingsExtras: FC<{ s: Settings; csrf: string; libraries: Lib[]; arr: { radarr: boolean; sonarr: boolean } }> = ({ s, csrf, libraries, arr }) => (
  <Shell at="extras">
    <p class="muted lede">Each of these is optional and works on its own. Nothing here is needed for collections.</p>
    <nav class="jump" aria-label="On this page"><a href="#health">Library health</a><a href="#overlays">Poster overlays</a><a href="#home">Home-screen rows</a><a href="#arr">Radarr and Sonarr</a></nav>

    <section class="form-sec" id="health" aria-labelledby="health-h">
      <div class="section-head"><h2 id="health-h">Library health</h2><span class="aside">{s.health.enabled ? 'On' : 'Off'}</span></div>
      <form method="post" action="/settings/health" class="form">
        <Csrf token={csrf} />
        <label class="check"><input type="checkbox" name="healthEnabled" value="1" checked={s.health.enabled} /> Check files and posters against their titles</label>
        <p class="hint">Flags movies and episodes whose length, title tags or default audio don’t match, and posters that are missing, taken from the video or file, in another language or from another title. Files are never changed. What it finds is in your <a href="/health">Inbox, under Library health</a>.</p>
        <div class="field"><span class="label">Fix posters without asking in</span>
          <div class="checks">{libraries.length ? libraries.map((l) => <label class="check"><input type="checkbox" name="autoFixLib" value={l.id} checked={(s.health.autoFixLibraryIds ?? []).includes(l.id)} /> {l.name}</label>) : <span class="faint">No libraries yet.</span>}</div>
          <span class="hint">Only “No poster” and “Poster from the video or file”, from TMDb, by the title’s confirmed TMDb ID, and only once you’ve stopped approving everything first. The old poster is kept, to undo. Everything else waits for you.</span></div>
        <div class="save-row"><button class="btn primary" type="submit">Save Library health</button></div>
      </form>
    </section>

    <section class="form-sec" id="overlays" aria-labelledby="overlays-h">
      <div class="section-head"><h2 id="overlays-h">Poster overlays</h2><span class="aside">badges on posters; the originals are kept</span></div>
      <div hx-get="/settings/overlays" hx-trigger="load" hx-swap="innerHTML"><p class="muted">Working out which posters get badges…</p></div>
    </section>

    <section class="form-sec" id="home" aria-labelledby="home-h">
      <div class="section-head"><h2 id="home-h">Home-screen rows</h2><span class="aside">needs two Jellyfin plugins</span></div>
      <div hx-get="/settings/home" hx-trigger="load" hx-swap="innerHTML"><p class="muted">Checking Jellyfin’s plugins…</p></div>
    </section>

    <section class="form-sec" id="arr" aria-labelledby="arr-h">
      <div class="section-head"><h2 id="arr-h">Radarr and Sonarr</h2><span class="aside">how missing titles are sent</span></div>
      {arr.radarr || arr.sonarr
        ? <div hx-get="/settings/arr" hx-trigger="load" hx-swap="innerHTML"><p class="muted">Reading options from Radarr and Sonarr…</p></div>
        : <p class="muted">Not connected. Add Radarr or Sonarr under <a href="/settings">Connections</a> to send the titles your collections list and you don’t have.</p>}
    </section>
  </Shell>
);

export const SettingsAdvanced: FC<{ s: Settings; csrf: string; masked: Masked; media: MediaStatus; claude: { tokens: ApiToken[]; reveal: Reveal | null; endpoint: string } }> = ({ s, csrf, masked, media, claude }) => (
  <Shell at="advanced">
    <p class="muted lede">Most installs never change these.</p>
    <form method="post" action="/settings/advanced" class="form">
      <Csrf token={csrf} />
      <section class="form-sec" id="imdb" aria-labelledby="imdb-h">
        <div class="section-head"><h2 id="imdb-h">How IMDb is read</h2></div>
        <div class="choice" role="radiogroup" aria-labelledby="imdb-h">
          <label><input type="radio" name="imdbRoute" value="direct" checked={s.imdbRoute === 'direct' || s.imdbRoute === 'tmdb'} /><b>Straight from IMDb (recommended)</b><span>This server asks IMDb itself.</span></label>
          <label><input type="radio" name="imdbRoute" value="snapshot" checked={s.imdbRoute === 'snapshot'} /><b>From a daily snapshot</b><span>For when IMDb refuses this server. A scheduled job somewhere else (GitHub Actions, for example) asks IMDb the same questions and publishes the answers as a file, and the app reads that. See docs/IMDB-SNAPSHOT.md.</span></label>
          <label><input type="radio" name="imdbRoute" value="kometa_service" checked={s.imdbRoute === 'kometa_service'} /><b>Through Kometa’s hosted service</b><span>The exact results Kometa gets, from servers the Kometa team runs for Kometa users. Use it only to check a difference with Plex.</span></label>
        </div>
        <details class="how" open={s.imdbRoute === 'snapshot'}>
          <summary>Snapshot details</summary>
          <div class="grid2">
            <div class="field"><label for="snap-url">Snapshot address</label><input id="snap-url" name="snapshotUrl" type="url" value={s.snapshotUrl} placeholder="https://raw.githubusercontent.com/you/repo/imdb-snapshot/imdb-snapshot.json" /><span class="hint">Only used with the snapshot. <a href="/settings/imdb/queries.json">Download the list of questions</a> the snapshot job needs.</span></div>
            <div class="field"><label for="snap-token">Access token</label><input id="snap-token" name="snapshotToken" type="password" autocomplete="off" placeholder={masked.imdbSnapshot?.set ? `•••• ${masked.imdbSnapshot.last4} (leave empty to keep)` : 'Only for a private repository'} /><span class="hint">Stored encrypted.</span></div>
          </div>
        </details>
      </section>
      <MediaFields s={s} media={media} />
      <div class="save-row"><button class="btn primary" type="submit">Save</button></div>
    </form>
    <ClaudeAccess tokens={claude.tokens} reveal={claude.reveal} endpoint={claude.endpoint} tz={s.timezone} csrf={csrf} />
  </Shell>
);

/** The optional read-only media mount (ADR-044): on or off, where it is, and how it's going. */
const MediaFields: FC<{ s: Settings; media: MediaStatus }> = ({ s, media }) => {
  const status = !media.enabled ? null
    : !media.mounted ? `Nothing is mounted at ${media.dir} in this container yet.`
    : !media.map ? 'Mounted. Jellyfin’s files will be found there on the next run.'
    : `Mounted: Jellyfin’s ${media.map.from || '/'} is ${media.map.to} here. ${media.read.toLocaleString('en-US')} ${media.read === 1 ? 'file’s' : 'files’'} own title read${media.unreadable ? `; ${media.unreadable.toLocaleString('en-US')} couldn’t be read` : ''}.`;
  return (
    <section class="form-sec" id="media" aria-labelledby="media-h">
      <div class="section-head"><h2 id="media-h">Media files</h2><span class="aside">for Library health; read-only</span></div>
      <input type="hidden" name="mediaSent" value="1" />
      <label class="check"><input type="checkbox" name="mediaEnabled" value="1" checked={s.media.enabled} /> Read each new file’s own title from a read-only mount</label>
      <p class="hint">A file can carry a title of its own inside it, which Jellyfin doesn’t show. It’s what gives away one movie hiding in another’s file. To let Library health read it, mount your media folder read-only in this container. Only a few kilobytes of each new file are read; nothing is ever changed.</p>
      <div class="grid2">
        <div class="field"><label for="mediaDir">Where it’s mounted in this container</label><input id="mediaDir" name="mediaDir" type="text" value={s.media.dir} autocomplete="off" />
          {status ? <span class="hint">{status}</span> : null}
          {media.enabled && media.note ? <span class="hint warn-text">{media.note}</span> : null}
        </div>
      </div>
      <details class="how"><summary>How to mount it, and frames from the middle</summary>
        <ul class="plain-list">
          <li><b>Mounting.</b> Under <code>volumes</code> in your compose file add, for example, <code>- /srv/media:/media:ro</code>. The folder must be readable by uid 1000.</li>
          <li><b>Frames from the middle.</b> Library health can show one frame from the middle of a flagged file, hidden until you open it. It comes from Jellyfin’s trickplay previews when Jellyfin has made them (Dashboard → Libraries → library → Trickplay). Otherwise, with the mount on, it comes from ffmpeg: {media.ffmpeg ? <b>found ({media.ffmpeg})</b> : 'not in this image; mount an ffmpeg binary and set FFMPEG_PATH to use it'}.</li>
        </ul>
      </details>
    </section>
  );
};
