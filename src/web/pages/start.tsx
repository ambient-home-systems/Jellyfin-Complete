/** @jsxImportSource hono/jsx */
// Getting started (first-run guide, ADR-046): one step open at a time, one Continue per step. The first run starts as
// soon as the collections are chosen, so its results are ready by the last step.
import type { Child, FC } from 'hono/jsx';
import { Csrf, Icon } from '../ui.js';
import type { Settings } from '../../settings.js';
import { FAMILY_LABEL, type PresetFamily } from '../../presets/index.js';
import type { Progress } from '../../pipeline/run.js';
import { timezoneOptions } from '../terms.js';

export const START_STEPS = 6;

export type StartModel = {
  s: Settings;
  libraries: { id: string; name: string; collectionType: string | null }[];
  /** Why the libraries couldn't be read from Jellyfin, if they couldn't. */
  libError: string | null;
  tmdbSet: boolean;
  families: { family: PresetFamily; on: number; total: number; note: string }[];
  /** Collections Jellyfin already has under one of your names: how many, or why they couldn't be read. */
  existing: { count: number; error: string | null };
  hasRun: boolean;
  progress: Progress | null;
  /** How many changes wait in the Inbox. */
  pending: number;
  /** The step that's open. */
  step: number;
  csrf: string;
};

/** Which steps are finished. Step 5 finishes itself when Jellyfin has nothing to take over. */
export function stepsDone(m: Pick<StartModel, 's' | 'tmdbSet' | 'existing' | 'hasRun' | 'progress'>): boolean[] {
  const done = (k: string) => (m.s.onboarding.done as string[]).includes(k);
  const families = done('families');
  return [
    done('libraries'),
    done('timezone'),
    done('tmdb') || m.tmdbSet,
    families,
    done('existing') || (families && !m.existing.error && m.existing.count === 0),
    m.hasRun && m.progress?.status !== 'running',
  ];
}

const Step: FC<{ n: number; title: string; done: boolean; open: boolean; summary?: Child; children?: Child }> = ({ n, title, done, open, summary, children }) => (
  <section class={`start-step${done ? ' done' : ''}${open ? ' open' : ''}`} aria-labelledby={`st-${n}`} aria-current={open ? 'step' : undefined}>
    <div class="section-head">
      <h2 id={`st-${n}`}><span class="num step-n">{done && !open ? <Icon name="check" /> : n}</span> {title}</h2>
      {!open ? <span class="aside">{summary}{done ? <a href={`/start?step=${n}`}>Change</a> : null}</span> : null}
    </div>
    {open ? <div class="step-body">{children}</div> : null}
  </section>
);

export const Start: FC<{ m: StartModel }> = ({ m }) => {
  const { s, csrf, step } = m;
  const done = stepsDone(m);
  const movies = m.libraries.filter((l) => l.collectionType === 'movies');
  const shows = m.libraries.filter((l) => l.collectionType === 'tvshows');
  const chosen = (ids: string[] | null, all: typeof movies) => (ids ? all.filter((l) => ids.includes(l.id)) : all).map((l) => l.name);
  const running = m.progress?.status === 'running';
  const on = m.families.filter((f) => f.on > 0).map((f) => FAMILY_LABEL[f.family]);
  return (
    <>
      <header class="top"><h1>Getting started</h1>
        <div class="actions"><form method="post" action="/start/finish" class="inline-form"><Csrf token={csrf} /><button class="btn ghost" type="submit">Skip the guide</button></form></div>
      </header>
      <div class="content narrow-content">
        <p class="lede">Six short steps. Nothing changes in Jellyfin along the way: everything the app would do waits for your approval.</p>
        <ol class="steps" aria-label="Progress">
          {Array.from({ length: START_STEPS }, (_, i) => <li class={i + 1 === step ? 'at' : done[i] ? 'done' : ''} aria-label={`Step ${i + 1}${i + 1 === step ? ', current' : done[i] ? ', done' : ''}`}></li>)}
        </ol>

        <Step n={1} title="Libraries" done={done[0]!} open={step === 1} summary={[...chosen(s.movieLibraryIds, movies), ...chosen(s.showLibraryIds, shows)].join(', ')}>
          <form method="post" action="/settings/libraries" class="form">
            <Csrf token={csrf} /><input type="hidden" name="next" value="/start?step=2" />
            <p class="muted">Collections take their titles from the libraries you tick. All are ticked to start with.</p>
            {m.libError ? (
              <p class="callout err" role="alert">Couldn’t read your libraries from Jellyfin: {m.libError}. Check the Jellyfin address and key in <a href="/settings">Settings</a>, then come back. Until you choose, every library is used.</p>
            ) : !movies.length && !shows.length ? (
              <p class="callout">Jellyfin reports no movie or TV libraries yet. Add one in Jellyfin, then reload this page.</p>
            ) : (
              <>
                {movies.length ? <fieldset class="plain"><legend class="label">Movies</legend><div class="checks">
                  {movies.map((l) => <label class="check"><input type="checkbox" name="movieLibraryIds" value={l.id} checked={!s.movieLibraryIds || s.movieLibraryIds.includes(l.id)} /> {l.name}</label>)}
                </div></fieldset> : null}
                {shows.length ? <fieldset class="plain"><legend class="label">Shows and episodes</legend><div class="checks">
                  {shows.map((l) => <label class="check"><input type="checkbox" name="showLibraryIds" value={l.id} checked={!s.showLibraryIds || s.showLibraryIds.includes(l.id)} /> {l.name}</label>)}
                </div></fieldset> : null}
              </>
            )}
            <div><button class="btn primary" type="submit">Continue</button></div>
          </form>
        </Step>

        <Step n={2} title="Timezone" done={done[1]!} open={step === 2} summary={s.timezone.replace(/_/g, ' ')}>
          <form method="post" action="/start/timezone" class="form">
            <Csrf token={csrf} />
            <p class="muted">Seasonal collections appear and go away at midnight in this timezone.</p>
            <div class="field"><label for="st-tz">Timezone</label>
              <select id="st-tz" name="timezone">{timezoneOptions(s.timezone).map((z) => <option value={z} selected={z === s.timezone}>{z.replace(/_/g, ' ')}</option>)}</select>
            </div>
            <div><button class="btn primary" type="submit">Continue</button></div>
          </form>
        </Step>

        <Step n={3} title="TMDb key" done={done[2]!} open={step === 3} summary={m.tmdbSet ? 'Key saved' : done[2] ? 'Skipped for now' : 'Recommended'}>
          <form method="post" action="/start/tmdb" class="form">
            <Csrf token={csrf} />
            <p class="muted">Recommended, and free: create one at themoviedb.org (Settings → API). Movie series and streaming-service collections need it, and it helps match titles your library only knows by TMDb ID. Leave it empty to skip for now.</p>
            <div class="field"><label for="st-tmdb">TMDb API key</label><input id="st-tmdb" name="key" type="password" autocomplete="off" placeholder={m.tmdbSet ? 'Saved (leave empty to keep it)' : ''} /></div>
            <div><button class="btn primary" type="submit">Continue</button></div>
          </form>
        </Step>

        <Step n={4} title="Which collections" done={done[3]!} open={step === 4} summary={on.join(', ') || 'None yet'}>
          <form method="post" action="/start/families" class="form">
            <Csrf token={csrf} /><input type="hidden" name="run" value="1" />
            <p class="muted">Ready-made collections, in groups. You can turn single ones on or off later under Collections, and make your own.</p>
            <div class="choice">
              {m.families.map((f) => (
                <label><input type="checkbox" name="families" value={f.family} checked={f.on > 0} /><b>{FAMILY_LABEL[f.family]}</b><span>{f.note}</span></label>
              ))}
            </div>
            <p class="hint">Continuing starts the first run in the background: it reads your library and every list, and can take a few minutes. Nothing changes in Jellyfin.</p>
            <div><button class="btn primary" type="submit">{m.hasRun || running ? 'Continue' : 'Continue and start the first run'}</button></div>
          </form>
        </Step>

        <Step n={5} title="Collections already in Jellyfin" done={done[4]!} open={step === 5} summary={m.existing.error ? 'Couldn’t check' : m.existing.count ? `${m.existing.count} to look at` : done[3] ? 'Nothing to do' : ''}>
          {m.existing.error ? (
            <p class="callout err" role="alert">Couldn’t read Jellyfin’s collections: {m.existing.error}. You can check later under Collections → Already in Jellyfin.</p>
          ) : m.existing.count ? (
            <>
              <p class="muted">Jellyfin already has {m.existing.count === 1 ? '1 collection' : `${m.existing.count} collections`} with the same name as one of the collections you chose. The app leaves {m.existing.count === 1 ? 'it' : 'them'} alone, and makes nothing new under that name, until you take {m.existing.count === 1 ? 'it' : 'them'} over or delete {m.existing.count === 1 ? 'it' : 'them'}. If another tool makes {m.existing.count === 1 ? 'it' : 'them'}, stop that tool doing so first.</p>
              <p><a class="btn" href="/adoption">Look at {m.existing.count === 1 ? 'it' : 'them'}</a></p>
            </>
          ) : (
            <p class="muted">Jellyfin has no collections with the same names as the ones you chose, so there’s nothing to do here.</p>
          )}
          <form method="post" action="/start/existing" class="form"><Csrf token={csrf} /><div><button class="btn primary" type="submit">Continue</button></div></form>
        </Step>

        <Step n={6} title="Your first changes" done={done[5]!} open={step === 6} summary="">
          {running ? (
            // Asks again every few seconds while the run is going, so this step fills in when it finishes.
            <div hx-get="/start?step=6" hx-trigger="every 4s" hx-select="#main" hx-target="#main" hx-swap="outerHTML">
              <p class="muted"><span class="btn loading bare" aria-hidden="true"></span> The first run is still going: {m.progress?.step ?? 'reading your library and lists'}. You can wait here or finish now; the results will be in your Inbox either way.</p>
            </div>
          ) : m.hasRun ? (
            <p class="muted">{m.progress?.status === 'failed' ? `The first run failed: ${m.progress.error}. Home shows what went wrong, and you can run again from there.` : m.pending ? `The first run is finished. ${m.pending === 1 ? '1 change waits' : `${m.pending} changes wait`} in your Inbox. Nothing happens in Jellyfin until you approve it.` : 'The first run is finished and found nothing to change right now. Collections are planned two weeks before they appear, so your Inbox fills as their dates come up.'}</p>
          ) : (
            <p class="muted">The first run reads your library and every list, which can take a few minutes. What it would change then waits in your Inbox.</p>
          )}
          <div class="actions-row">
            {!m.hasRun && !running ? <form method="post" action="/runs" class="inline-form"><Csrf token={csrf} /><input type="hidden" name="next" value="/start?step=6" /><button class="btn primary" type="submit"><Icon name="play" /> Run now</button></form> : null}
            <form method="post" action="/start/finish" class="inline-form"><Csrf token={csrf} /><input type="hidden" name="next" value="/review" /><button class={`btn${m.hasRun || running ? ' primary' : ''}`} type="submit">Finish and open the Inbox</button></form>
            <form method="post" action="/start/finish" class="inline-form"><Csrf token={csrf} /><button class="btn ghost" type="submit">Finish and go to Home</button></form>
          </div>
        </Step>
      </div>
    </>
  );
};
