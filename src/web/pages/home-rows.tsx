/** @jsxImportSource hono/jsx */
// Settings → Home-screen rows (Phase 3, ADR-025): plugin status, the rows we manage, and their options.
import type { FC } from 'hono/jsx';
import { Csrf, Dot } from '../ui.js';
import type { HomeStatus } from '../../homescreen/index.js';
import { ROW_ITEM_CAP } from '../../homescreen/index.js';
import type { Settings } from '../../settings.js';

const plugin = (label: string, p: HomeStatus['hss']) => (
  <li><Dot state={p.installed ? 'ok' : 'err'} label={p.installed ? 'installed' : 'missing'} /> <b>{label}</b> {p.installed ? <span class="faint">{p.version}{p.status && p.status !== 'Active' ? ` · ${p.status}` : ''}</span> : <span class="faint">not installed</span>}</li>
);

export const HomeRowsPanel: FC<{ st: HomeStatus; s: Settings; csrf: string }> = ({ st, s, csrf }) => (
  <>
    <ul class="plain-list">
      {plugin('Home Screen Sections', st.hss)}
      {plugin('Collection Sections', st.cs)}
      {st.hss.installed && st.hssEnabled === false ? <li class="faint">Home Screen Sections is installed but switched off in its own settings, so Jellyfin shows its normal home screen.</li> : null}
    </ul>
    {st.problem ? (
      <p class="callout">
        {st.problem} Both plugins come from IAmParadox27’s repository (Dashboard → Plugins → Repositories: <code>https://www.iamparadox.dev/jellyfin/plugins/manifest.json</code>). Install Home Screen Sections and Collection Sections, then restart Jellyfin.
      </p>
    ) : null}
    <form method="post" action="/settings/home" class="form">
      <Csrf token={csrf} />
      <label class="check"><input type="checkbox" name="enabled" value="1" checked={s.homeRows.enabled} /> Show a row on the home screen for each live collection that asks for one</label>
      <div class="grid3">
        <div class="field"><label for="hr-view">Card style</label>
          <select id="hr-view" name="viewMode">{(['Portrait', 'Landscape', 'Square', 'Small'] as const).map((v) => <option value={v} selected={s.homeRows.viewMode === v}>{v}</option>)}</select></div>
        <div class="field"><label for="hr-order">Position</label><input id="hr-order" name="orderIndex" type="number" min={0} max={99} value={String(s.homeRows.orderIndex)} class="num" /><span class="hint">Home Screen Sections’ order index for the first row; 0 is the top.</span></div>
      </div>
      <p class="hint">Each row shows up to {ROW_ITEM_CAP} titles from its box set, appears when the collection goes live and disappears when it closes. Every user sees the same rows. Turn a row on or off per collection in its editor (Output in Jellyfin).</p>
      <div class="actions-row"><button class="btn primary" type="submit">Save</button></div>
    </form>
    {st.rows.length ? (
      <table class="tt" aria-label="Home-screen rows">
        <thead><tr><th scope="col">Row</th><th scope="col">Now</th></tr></thead>
        <tbody>{[...st.rows].sort((a, b) => Number(b.live) - Number(a.live)).map((r) => <tr class={r.live ? '' : 'faint'}><td><a href={`/collections/${r.definitionId}`}>{r.name}</a></td><td>{r.live ? <span class="chip solid">Showing</span> : <span class="chip faint">Hidden until live</span>}</td></tr>)}</tbody>
      </table>
    ) : <p class="muted">No collection asks for a row yet.</p>}
    <form method="post" action="/settings/home/sync" class="inline-form" style="margin-top:var(--s3)">
      <Csrf token={csrf} />
      <button class="btn" type="submit" disabled={Boolean(st.problem)}>Update rows in Jellyfin now</button>
      <span class="hint"> Runs also do this. Dry run doesn’t stop this button: pressing it is an explicit approval.</span>
    </form>
  </>
);
