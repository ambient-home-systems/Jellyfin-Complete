/** @jsxImportSource hono/jsx */
// "Run now" with live progress: HTMX polls /runs/progress every second while a run is going (no modal).
import type { FC } from 'hono/jsx';
import { Icon } from '../ui.js';
import type { Progress } from '../../pipeline/run.js';

export const RunProgress: FC<{ p: Progress | null; csrf: string }> = ({ p, csrf }) => {
  if (p?.status === 'running') {
    return (
      <span id="run-progress" class="progress" hx-get="/runs/progress" hx-trigger="every 1s" hx-swap="outerHTML" role="status">
        <span class="btn loading" aria-busy="true">Running…</span>
        <span>{p.step}</span>
      </span>
    );
  }
  return (
    <span id="run-progress" class="progress">
      {p && p.finishedAt && Date.now() - p.finishedAt < 60_000 ? (
        <span role="status">{p.status === 'ok' ? 'Run finished.' : `Run failed: ${p.error}`} <a href="/">Refresh</a></span>
      ) : null}
      <form method="post" action="/runs" hx-post="/runs" hx-target="#run-progress" hx-swap="outerHTML" class="inline-form">
        <input type="hidden" name="_csrf" value={csrf} />
        <button class="btn primary" type="submit"><Icon name="play" /> Run now</button>
      </form>
    </span>
  );
};
