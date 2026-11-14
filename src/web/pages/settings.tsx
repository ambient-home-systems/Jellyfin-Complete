/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Icon, Csrf, Seg, fmtDate, fmtTime } from '../ui.js';
import type { Settings } from '../../settings.js';
import type { SecretName } from '../../secrets.js';
import { JOBS } from '../../jobs/schedules.js';
import { ClaudeAccess, type Reveal } from './claude-access.js';
import type { ApiToken } from '../api-tokens.js';
import type { MediaStatus } from '../../library/media.js';

export type ConnRow = { key: string; name: string; urlField?: keyof Settings['connections']; secret?: SecretName; secretLabel: string; note?: string; optional?: boolean };
export const CONNECTIONS: ConnRow[] = [
  { key: 'jellyfin', name: 'Jellyfin', urlField: 'jellyfinUrl', secret: 'jellyfin.apiKey', secretLabel: 'API key' },
  { key: 'tmdb', name: 'TMDb', secret: 'tmdb.apiKey', secretLabel: 'API key', note: 'api.themoviedb.org' },
  { key: 'mdblist', name: 'MDBList', secret: 'mdblist.apiKey', secretLabel: 'API key', note: 'Optional: public lists work without a key', optional: true },
  { key: 'plex', name: 'Plex', urlField: 'plexUrl', secret: 'plex.token', secretLabel: 'Token', note: 'Optional: only to compare a collection with the same-named one in Plex. Read-only.', optional: true },
  { key: 'radarr', name: 'Radarr', urlField: 'radarrUrl', secret: 'radarr.apiKey', secretLabel: 'API key', optional: true },
  { key: 'sonarr', name: 'Sonarr', urlField: 'sonarrUrl', secret: 'sonarr.apiKey', secretLabel: 'API key', optional: true },
];

const MODE_ROWS: [string, string][] = [
  ['collection.create', 'Create and delete box set'], ['collection.add_items', 'Add items'], ['collection.remove_items', 'Remove items'],
  ['collection.update_metadata', 'Update metadata'], ['radarr.add_movie', 'Add film to Radarr'], ['sonarr.add_series', 'Add series to Sonarr'], ['radarr.monitor_collection', 'Monitor a TMDb collection in Radarr'],
];

export const SettingsPage: FC<{
  s: Settings; csrf: string; masked: Record<string, { set: boolean; last4: string | null }>;
  libraries: { id: string; name: string; collectionType: string | null }[];
  libError?: string | null;
  schedules: { job: string; cron: string; enabled: boolean; next: Date | null }[];
  claude: { tokens: ApiToken[]; reveal: Reveal | null; endpoint: string };
  /** The optional read-only media mount, as it is now (ADR-044). */
  media: MediaStatus;
}> = ({ s, csrf, masked, libraries, libError, schedules, claude, media }) => (
  <>
    <header class="top"><h1>Settings</h1></header>
    <div class="content">
      <div class="settings">
        <nav class="subnav" aria-label="Settings sections">
          <a href="#conn" aria-current="true">Connections</a><a href="#run">Run and review</a><a href="#modes">Action modes</a>
          <a href="#imdb">IMDb route</a><a href="#libs">Libraries</a><a href="#overlays">Poster overlays</a><a href="#sched">Schedules</a><a href="#claude">Claude access</a>
        </nav>
        <div>
          <section class="form-sec" id="conn" aria-labelledby="conn-h">
            <div class="section-head"><h2 id="conn-h">Connections</h2><span class="aside">Keys are encrypted at rest and never shown again</span></div>
            <form method="post" action="/settings/connections">
              <Csrf token={csrf} />
              {CONNECTIONS.map((c) => (
                <div class="conn">
                  <span class="nm">{c.name}</span>
                  {c.urlField ? <input class="url" type="url" name={`url:${c.key}`} value={s.connections[c.urlField]} placeholder="http://your-server:port" aria-label={`${c.name} URL`} /> : <span class="note">{c.note}</span>}
                  <input type="password" name={`secret:${c.key}`} autocomplete="off" placeholder={masked[c.key]?.set ? `•••• ${masked[c.key]?.last4 ?? ''} (leave blank to keep)` : c.optional ? 'Not set' : 'Required'} aria-label={`${c.name} ${c.secretLabel}`} />
                  <button class="btn sm" type="button" hx-post={`/settings/test/${c.key}`} hx-target={`#st-${c.key}`} hx-swap="innerHTML">Test</button>
                  <span class="st" id={`st-${c.key}`}>{masked[c.key]?.set ? <><span class="dot ok"></span> Key saved</> : c.optional ? <span class="faint">Optional</span> : <><span class="dot err"></span> Not set</>}</span>
                </div>
              ))}
              <div><button class="btn primary" type="submit">Save connections</button></div>
              <p class="hint">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
            </form>
          </section>

          <section class="form-sec" id="run" aria-labelledby="run-h">
            <div class="section-head"><h2 id="run-h">Run and review</h2></div>
            <form method="post" action="/settings/general" class="form">
              <Csrf token={csrf} />
              <label class="check" style="font-weight:600"><input type="checkbox" name="dryRun" value="1" checked={s.dryRun} /> Dry run: send every action to Review, whatever its mode</label>
              <div class="grid3">
                <div class="field"><label for="lead">Plan ahead (days before a window opens)</label><input id="lead" name="leadDays" type="number" min={0} max={60} value={String(s.leadDays)} class="num" /></div>
                <div class="field"><label for="tz">Timezone</label><input id="tz" name="timezone" type="text" value={s.timezone} /><span class="hint">IANA name, e.g. America/New_York. Windows flip at local midnight.</span></div>
                <div class="field"><label for="snooze">Default snooze</label><select id="snooze" name="defaultSnooze">{[['window', 'Until the window opens'], ['7d', '7 days'], ['30d', '30 days']].map(([v, l]) => <option value={v} selected={s.defaultSnooze === v}>{l}</option>)}</select></div>
              </div>
              <div class="grid3">
                <div class="field"><label for="cap">Radarr + Sonarr adds per run</label><input id="cap" name="arrCapPerRun" type="number" min={0} max={200} value={String(s.guardrails.arrCapPerRun)} class="num" /><span class="hint">Past the cap, adds go to Review (Phase 2).</span></div>
                <div class="field"><span class="label">Before any add</span><label class="check"><input type="checkbox" name="releasedOnly" value="1" checked={s.guardrails.releasedOnly} /> Released titles only</label><label class="check"><input type="checkbox" checked disabled /> Skip if already present or excluded</label></div>
                <div class="field"><label for="nb">Other tools’ schedules</label><textarea id="nb" name="neighbours" rows={3} placeholder={'Jellyfin-Auto-Collections 04:00\nKometa (Plex) 05:00'}>{s.neighbours.map((n) => `${n.name} ${n.time}`).join('\n')}</textarea><span class="hint">Shown beside this app’s jobs so they don’t collide.</span></div>
              </div>
              <div class="grid3">
                <div class="field"><span class="label">Library health</span><label class="check"><input type="checkbox" name="healthEnabled" value="1" checked={s.health.enabled} /> Check files and artwork</label><span class="hint">Flags films and episodes whose length, title tags or default audio don’t match, and posters that are missing, from the video or file, in another language or from another title. Files are never changed. <a href="/health">Library health</a></span></div>
                <div class="field"><span class="label">Fix posters by themselves in</span>
                  <input type="hidden" name="autoFixSent" value="1" />
                  {libraries.length ? libraries.map((l) => <label class="check"><input type="checkbox" name="autoFixLib" value={l.id} checked={(s.health.autoFixLibraryIds ?? []).includes(l.id)} /> {l.name}</label>) : <span class="faint">No libraries yet.</span>}
                  <span class="hint">Only “No poster” and “Poster from the video or file”, from TMDb, by the title’s confirmed TMDb ID, while dry run is off. The old one is kept, to undo. Everything else waits for you.</span></div>
                <div class="field"><label for="region">Streaming country</label><input id="region" name="streamingRegion" type="text" value={s.streaming.region} maxlength={2} pattern="[A-Za-z]{2}" class="num" autocomplete="off" /><span class="hint">Streaming collections count the services offered here. Two letters, such as US, GB or CA. Streaming data from JustWatch, through TMDb.</span></div>
              </div>
              <MediaFields s={s} media={media} />
              <div><button class="btn primary" type="submit">Save</button></div>
            </form>
          </section>

          <section class="form-sec" id="modes" aria-labelledby="modes-h">
            <div class="section-head"><h2 id="modes-h">Action modes</h2><span class="aside">Collections can override these</span></div>
            <form method="post" action="/settings/modes">
              <Csrf token={csrf} />
              <table class="modes">
                <thead><tr><th scope="col">Action</th><th scope="col">Default mode</th></tr></thead>
                <tbody>
                  {MODE_ROWS.map(([t, label]) => (
                    <tr><td>{label}</td><td><Seg name={`mode:${t}`} value={s.modes[t as keyof Settings['modes']]} options={[['off', 'Off'], ['review', 'Review'], ['auto', 'Auto']]} label={label} /></td></tr>
                  ))}
                </tbody>
              </table>
              <div style="margin-top:var(--s3)"><button class="btn primary" type="submit">Save modes</button></div>
            </form>
          </section>

          <section class="form-sec" id="imdb" aria-labelledby="imdb-h">
            <div class="section-head"><h2 id="imdb-h">IMDb search route</h2></div>
            <form method="post" action="/settings/imdb">
              <Csrf token={csrf} />
              <div class="choice" role="radiogroup" aria-labelledby="imdb-h">
                <label><input type="radio" name="imdbRoute" value="direct" checked={s.imdbRoute === 'direct'} /><b>IMDb GraphQL, directly (recommended)</b><span>Sent from this server.</span></label>
                <label><input type="radio" name="imdbRoute" value="kometa_service" checked={s.imdbRoute === 'kometa_service'} /><b>Kometa’s hosted IMDb service</b><span>Exact Kometa parity, on infrastructure the Kometa team runs for Kometa users. Use for parity checks only.</span></label>
                <label><input type="radio" name="imdbRoute" value="snapshot" checked={s.imdbRoute === 'snapshot'} /><b>Daily snapshot</b><span>If IMDb refuses this server: a scheduled job elsewhere (for example GitHub Actions) runs the same queries and publishes a JSON file, and the app reads that. See docs/IMDB-SNAPSHOT.md.</span></label>
              </div>
              <div class="grid2" style="margin-top:var(--s3)">
                <div class="field"><label for="snap-url">Snapshot URL</label><input id="snap-url" name="snapshotUrl" type="url" value={s.snapshotUrl} placeholder="https://raw.githubusercontent.com/you/repo/imdb-snapshot/imdb-snapshot.json" /><span class="hint">Only used by the snapshot route. <a href="/settings/imdb/queries.json">Download the query list</a> for the snapshot job.</span></div>
                <div class="field"><label for="snap-token">Access token</label><input id="snap-token" name="snapshotToken" type="password" autocomplete="off" placeholder={masked.imdbSnapshot?.set ? `•••• ${masked.imdbSnapshot.last4} (leave blank to keep)` : 'Only for a private repository'} /><span class="hint">Sent as a bearer token. Stored encrypted.</span></div>
              </div>
              <div style="margin-top:var(--s3)"><button class="btn primary" type="submit">Save route</button></div>
            </form>
          </section>

          <section class="form-sec" id="libs" aria-labelledby="libs-h">
            <div class="section-head"><h2 id="libs-h">Libraries</h2></div>
            <form method="post" action="/settings/libraries">
              <Csrf token={csrf} />
              {libraries.filter((l) => l.collectionType === 'movies').length === 0
                ? <p class="muted">{libError ? `Couldn’t read your libraries from Jellyfin (${libError}). Until you choose, every movie library is used.` : 'Jellyfin reports no movie libraries.'}</p>
                : null}
              <fieldset class="plain"><legend class="label">Films come from</legend>
                <div class="checks">
                  {libraries.filter((l) => l.collectionType === 'movies').map((l) => (
                    <label class="check"><input type="checkbox" name="movieLibraryIds" value={l.id} checked={!s.movieLibraryIds || s.movieLibraryIds.includes(l.id)} /> {l.name}</label>
                  ))}
                </div>
              </fieldset>
              {libraries.some((l) => l.collectionType === 'tvshows') ? (
                <fieldset class="plain"><legend class="label">Shows and episodes come from</legend>
                  <div class="checks">
                    {libraries.filter((l) => l.collectionType === 'tvshows').map((l) => (
                      <label class="check"><input type="checkbox" name="showLibraryIds" value={l.id} checked={!s.showLibraryIds || s.showLibraryIds.includes(l.id)} /> {l.name}</label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <div style="margin-top:var(--s3)"><button class="btn primary" type="submit">Save libraries</button></div>
            </form>
          </section>

          <section class="form-sec" id="home" aria-labelledby="home-h">
            <div class="section-head"><h2 id="home-h">Home-screen rows</h2><span class="aside">Home Screen Sections + Collection Sections</span></div>
            <div hx-get="/settings/home" hx-trigger="load" hx-swap="innerHTML"><p class="muted">Checking Jellyfin’s plugins…</p></div>
          </section>

          <section class="form-sec" id="overlays" aria-labelledby="overlays-h">
            <div class="section-head"><h2 id="overlays-h">Poster overlays</h2><span class="aside">badges on posters, originals kept</span></div>
            <div hx-get="/settings/overlays" hx-trigger="load" hx-swap="innerHTML"><p class="muted">Working out which posters get badges…</p></div>
          </section>

          <section class="form-sec" id="arr" aria-labelledby="arr-h">
            <div class="section-head"><h2 id="arr-h">Radarr and Sonarr</h2><span class="aside">defaults for sending missing titles</span></div>
            <div hx-get="/settings/arr" hx-trigger="load" hx-swap="innerHTML"><p class="muted">Reading options from Radarr and Sonarr…</p></div>
          </section>

          <section class="form-sec" id="sched" aria-labelledby="sched-h">
            <div class="section-head"><h2 id="sched-h">Schedules</h2><span class="aside">{s.timezone}</span></div>
            <form method="post" action="/settings/schedules">
              <Csrf token={csrf} />
              <div class="table-wrap">
                <table class="tt">
                  <thead><tr><th scope="col">Job</th><th scope="col">Cron</th><th scope="col">On</th><th scope="col">Next</th></tr></thead>
                  <tbody>
                    {schedules.map((j) => (
                      <tr>
                        <td><b>{JOBS[j.job as keyof typeof JOBS]?.label ?? j.job}</b><br /><span class="faint">{JOBS[j.job as keyof typeof JOBS]?.detail}</span></td>
                        <td><input type="text" name={`cron:${j.job}`} value={j.cron} aria-label={`${j.job} cron`} style="max-width:12em" /></td>
                        <td><input type="checkbox" name={`on:${j.job}`} value="1" checked={j.enabled} aria-label={`${j.job} enabled`} /></td>
                        <td class="num">{j.next ? `${fmtDate(j.next.getTime(), s.timezone)} ${fmtTime(j.next.getTime(), s.timezone)}` : '—'}</td>
                      </tr>
                    ))}
                    {s.neighbours.map((n) => <tr><td class="faint">{n.name}</td><td class="faint">{n.time}</td><td colspan={2} class="faint">other tool</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div style="margin-top:var(--s3)"><button class="btn primary" type="submit"><Icon name="check" /> Save schedules</button></div>
            </form>
          </section>

          <ClaudeAccess tokens={claude.tokens} reveal={claude.reveal} endpoint={claude.endpoint} tz={s.timezone} csrf={csrf} />
        </div>
      </div>
    </div>
  </>
);

/** The optional read-only media mount (ADR-044): on or off, where it is, and how it's going. */
const MediaFields: FC<{ s: Settings; media: MediaStatus }> = ({ s, media }) => {
  const status = !media.enabled ? null
    : !media.mounted ? `Nothing is mounted at ${media.dir} in this container yet.`
    : !media.map ? 'Mounted. Jellyfin’s files will be found there on the next run.'
    : `Mounted: Jellyfin’s ${media.map.from || '/'} is ${media.map.to} here. ${media.read.toLocaleString('en-US')} ${media.read === 1 ? 'file’s' : 'files’'} own title read${media.unreadable ? `; ${media.unreadable.toLocaleString('en-US')} couldn’t be read` : ''}.`;
  return (
    <div class="grid3">
      <div class="field"><span class="label">Media files (optional)</span>
        <input type="hidden" name="mediaSent" value="1" />
        <label class="check"><input type="checkbox" name="mediaEnabled" value="1" checked={s.media.enabled} /> Read each new file’s own title from a read-only mount</label>
        <span class="hint">Jellyfin doesn’t show a file’s own title, the tag that gives away a film hiding inside another’s file. Mount your media folder read-only, for example <code>- /srv/media:/media:ro</code> under <code>volumes</code>, readable by uid 1000. Only a few kilobytes of each new file are read; nothing is ever changed.</span>
      </div>
      <div class="field"><label for="mediaDir">Mounted at (in this container)</label><input id="mediaDir" name="mediaDir" type="text" value={s.media.dir} autocomplete="off" />
        {status ? <span class="hint">{status}</span> : null}
        {media.enabled && media.note ? <span class="hint warn-text">{media.note}</span> : null}
      </div>
      <div class="field"><span class="label">Frames from the middle</span>
        <span class="hint">Library health can show one frame from the middle of a flagged file, hidden until you open it. It comes from Jellyfin’s trickplay previews when Jellyfin has made them (Dashboard → Libraries → library → Trickplay). Otherwise, with the media mount on, it comes from ffmpeg on the file: {media.ffmpeg ? <b>found ({media.ffmpeg})</b> : 'not in this image; mount an ffmpeg binary and set FFMPEG_PATH to use it'}.</span>
      </div>
    </div>
  );
};
