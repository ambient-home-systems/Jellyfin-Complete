/** @jsxImportSource hono/jsx */
// Getting started (Phase 4 first-run guide): the few choices a new install needs, in order, each saved on its own.
import type { FC } from 'hono/jsx';
import { Csrf, Icon } from '../ui.js';
import type { Settings } from '../../settings.js';
import { FAMILY_LABEL, type PresetFamily } from '../../presets/index.js';

export type StartModel = {
  s: Settings;
  libraries: { id: string; name: string; collectionType: string | null }[];
  tmdbSet: boolean;
  families: { family: PresetFamily; on: number; total: number; note: string }[];
  hasRun: boolean;
  csrf: string;
};

const Step: FC<{ n: number; title: string; done: boolean; children?: unknown }> = ({ n, title, done, children }) => (
  <section class={`form-sec start-step${done ? ' done' : ''}`} aria-labelledby={`st-${n}`}>
    <div class="section-head"><h2 id={`st-${n}`}><span class="num step-n">{n}</span> {title}</h2><span class="aside">{done ? <><Icon name="check" /> Done</> : 'To do'}</span></div>
    {children as never}
  </section>
);

export const Start: FC<{ m: StartModel }> = ({ m }) => {
  const { s, csrf } = m;
  const done = (k: string) => (s.onboarding.done as string[]).includes(k);
  const movies = m.libraries.filter((l) => l.collectionType === 'movies');
  const shows = m.libraries.filter((l) => l.collectionType === 'tvshows');
  return (
    <>
      <header class="top"><h1>Getting started</h1>
        <div class="actions"><form method="post" action="/start/finish" class="inline-form"><Csrf token={csrf} /><button class="btn ghost" type="submit">Skip the guide</button></form></div>
      </header>
      <div class="content narrow-content">
        <p class="lede">Six short steps. Dry run stays on throughout: nothing changes in Jellyfin until you approve it in Review.</p>

        <Step n={1} title="Libraries" done={done('libraries')}>
          <form method="post" action="/settings/libraries" class="form">
            <Csrf token={csrf} /><input type="hidden" name="next" value="/start#st-2" />
            <p class="muted">Which libraries collections take their titles from. All are ticked to start with.</p>
            <fieldset class="plain"><legend class="label">Films</legend><div class="checks">
              {movies.map((l) => <label class="check"><input type="checkbox" name="movieLibraryIds" value={l.id} checked={!s.movieLibraryIds || s.movieLibraryIds.includes(l.id)} /> {l.name}</label>)}
            </div></fieldset>
            {shows.length ? <fieldset class="plain"><legend class="label">Shows and episodes</legend><div class="checks">
              {shows.map((l) => <label class="check"><input type="checkbox" name="showLibraryIds" value={l.id} checked={!s.showLibraryIds || s.showLibraryIds.includes(l.id)} /> {l.name}</label>)}
            </div></fieldset> : null}
            <div><button class="btn primary" type="submit">Save libraries</button></div>
          </form>
        </Step>

        <Step n={2} title="Timezone" done={done('timezone')}>
          <form method="post" action="/start/timezone" class="form">
            <Csrf token={csrf} />
            <p class="muted">Seasonal collections open and close at midnight in this timezone.</p>
            <div class="field"><label for="st-tz">Timezone</label><input id="st-tz" name="timezone" type="text" value={s.timezone} /><span class="hint">An IANA name, for example America/New_York or Europe/London.</span></div>
            <div><button class="btn primary" type="submit">Save timezone</button></div>
          </form>
        </Step>

        <Step n={3} title="TMDb key (recommended)" done={m.tmdbSet}>
          <form method="post" action="/start/tmdb" class="form">
            <Csrf token={csrf} />
            <p class="muted">Free from themoviedb.org (Settings → API). Some sources need it, and it helps match titles your library only knows by TMDb ID.</p>
            <div class="field"><label for="st-tmdb">TMDb API key</label><input id="st-tmdb" name="key" type="password" autocomplete="off" placeholder={m.tmdbSet ? 'Saved (leave blank to keep)' : ''} /></div>
            <div><button class="btn primary" type="submit">Test and save</button></div>
          </form>
        </Step>

        <Step n={4} title="Which collections" done={done('families')}>
          <form method="post" action="/start/families" class="form">
            <Csrf token={csrf} />
            <p class="muted">Ready-made collections. You can turn single ones on or off later under Collections, and make your own.</p>
            <div class="choice">
              {m.families.map((f) => (
                <label><input type="checkbox" name="families" value={f.family} checked={f.on > 0} /><b>{FAMILY_LABEL[f.family]} <span class="faint num">{f.total}</span></b><span>{f.note}</span></label>
              ))}
            </div>
            <div><button class="btn primary" type="submit">Save</button></div>
          </form>
        </Step>

        <Step n={5} title="Box sets you already have" done={false}>
          <p class="muted">If another tool already makes some of these collections, remove them from that tool first. Then, on <a href="/adoption">Existing box sets</a>, adopt the sets with matching names or delete the old ones. The app never touches box sets it didn’t create or adopt.</p>
        </Step>

        <Step n={6} title="First run" done={m.hasRun}>
          <p class="muted">The first run reads your library and every source, which can take a few minutes. With dry run on, everything it would do waits in Review.</p>
          <div class="actions-row">
            <form method="post" action="/runs" class="inline-form"><Csrf token={csrf} /><button class="btn primary" type="submit"><Icon name="play" /> Run now</button></form>
            <form method="post" action="/start/finish" class="inline-form"><Csrf token={csrf} /><button class="btn" type="submit">Finish and go to the Dashboard</button></form>
          </div>
        </Step>
      </div>
    </>
  );
};
