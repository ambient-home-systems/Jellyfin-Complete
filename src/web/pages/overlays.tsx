/** @jsxImportSource hono/jsx */
// Settings → Poster overlays (ADR-039): which badges, what a run would change, previews, Apply now and Remove all.
import type { FC } from 'hono/jsx';
import { Csrf } from '../ui.js';

export type OverlaysModel = {
  status: boolean;
  imdbTop250: boolean;
  dryRun: boolean;
  /** Posters carrying overlays now. */
  withOverlays: number;
  /** Posters whose badges would change on the next update (from stored data; nothing fetched). */
  toChange: number;
  running: boolean;
  samples: { id: string; name: string; badges: string }[];
  /** The libraries collections draw from, and whether each gets overlays (kids' ones don't by default). */
  libraries: { id: string; name: string; kids: boolean; on: boolean }[];
  /** True while the default (no overlays in kids' libraries) applies. */
  libraryDefault: boolean;
};

export const OverlaysPanel: FC<{ m: OverlaysModel; csrf: string }> = ({ m, csrf }) => (
  <>
    <form method="post" action="/settings/overlays" class="form">
      <Csrf token={csrf} />
      <input type="hidden" name="libs" value="1" />
      <label class="check"><input type="checkbox" name="status" value="1" checked={m.status} /> <span><b>Status on shows:</b> AIRING (an episode in the last 14 days), RETURNING, CANCELED or ENDED, top left</span></label>
      <label class="check"><input type="checkbox" name="imdbTop250" value="1" checked={m.imdbTop250} /> <span><b>IMDb Top 250 ribbon</b> on films and shows in IMDb’s Top 250, bottom right</span></label>
      {m.libraries.length ? (
        <fieldset class="plain">
          <legend>Libraries with overlays</legend>
          {m.libraries.map((l) => (
            <label class="check"><input type="checkbox" name="lib" value={l.id} checked={l.on} /> <span>{l.name}{l.kids ? <span class="faint"> · kids’ library{m.libraryDefault ? ', off by default' : ''}</span> : null}</span></label>
          ))}
        </fieldset>
      ) : null}
      <p class="hint">
        Kometa’s designs, drawn on a copy of each poster at its own size. The original is kept in <code>/config/overlays/originals</code> and put back when you turn a badge off or remove them all; if Jellyfin gets a new poster, the badges go on the new one.
        Only titles in the libraries collections draw from, and ticked here, get overlays. A library counts as a kids’ library when its name says so or most of its titles have children’s ratings; those get none unless you tick them. Unticking a library takes its overlays off on the next update. {m.dryRun ? 'Dry run is on, so runs only check: use Apply now to change posters.' : 'Each run keeps them up to date.'}
      </p>
      <div class="actions-row"><button class="btn primary" type="submit">Save</button></div>
    </form>
    <p>
      {m.withOverlays === 1 ? '1 poster has overlays.' : `${m.withOverlays} posters have overlays.`}{' '}
      {m.toChange ? `${m.toChange} would change on the next update.` : 'Nothing to change.'}{' '}
      {m.running ? <span class="faint">A run is in progress.</span> : null}
    </p>
    <div class="actions-row">
      <form method="post" action="/settings/overlays/apply" class="inline-form"><Csrf token={csrf} /><button class="btn" type="submit" disabled={m.running || (!m.toChange && !m.withOverlays)}>Apply now</button></form>
      {m.withOverlays ? <form method="post" action="/settings/overlays/remove" class="inline-form"><Csrf token={csrf} /><button class="btn" type="submit" disabled={m.running}>Remove all overlays</button></form> : null}
    </div>
    {m.samples.length ? (
      <div class="overlay-previews" aria-label="Previews">
        {m.samples.map((x) => (
          <figure>
            <img src={`/settings/overlays/preview/${encodeURIComponent(x.id)}`} alt={`${x.name} with ${x.badges}`} loading="lazy" width={140} height={210} />
            <figcaption>{x.name}<br /><span class="faint">{x.badges}</span></figcaption>
          </figure>
        ))}
      </div>
    ) : null}
  </>
);
