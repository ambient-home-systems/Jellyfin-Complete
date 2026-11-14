/** @jsxImportSource hono/jsx */
// Inbox → Collection changes: what each run would change, grouped by collection, waiting for a decision.
import type { FC } from 'hono/jsx';
import { Icon, Csrf, InboxTabs, fmtDate, fmtTime, plural, type InboxCounts } from '../ui.js';
import type { reviewModel } from '../model.js';
import { CHANGE_LABEL, CHANGE_VERB, TAKES_AWAY } from '../terms.js';

type M = ReturnType<typeof reviewModel>;
/** The engine's names for each change, as the MCP endpoint reports them. The pages use terms.ts. */
export const TYPE_LABEL: Record<string, string> = {
  'collection.create': 'Create box set',
  'collection.delete': 'Delete box set',
  'collection.add_items': 'Add items',
  'collection.remove_items': 'Remove items',
  'collection.update_metadata': 'Update metadata',
  'collection.hide': 'Hide box set',
  'collection.show': 'Show box set',
  'radarr.add_movie': 'Add to Radarr',
  'sonarr.add_series': 'Add to Sonarr',
  'radarr.monitor_collection': 'Monitor in Radarr',
};

export type ReviewState = { dryRun: boolean; running: boolean; hasRun: boolean; nextRun: string | null; leadDays: number; filter: { id: number; name: string } | null };

export const Review: FC<{ m: M; csrf: string; tz: string; inbox: InboxCounts; st: ReviewState }> = ({ m, csrf, tz, inbox, st }) => {
  const tabs: [string, string, number][] = [['pending', 'To approve', m.counts.proposed ?? 0], ['snoozed', 'Snoozed', m.counts.snoozed ?? 0], ['dismissed', 'Dismissed', m.counts.dismissed ?? 0]];
  const pending = m.tab === 'pending';
  const cols = pending ? 5 : 4;
  return (
    <>
      <header class="top">
        <h1>Inbox</h1>
        <InboxTabs at="changes" c={inbox} />
      </header>
      <div class="content">
        <div class="subtabs-row">
          <nav class="subtabs" aria-label="Collection changes">
            {tabs.map(([key, label, n]) => <a aria-current={m.tab === key ? 'page' : undefined} href={`/review?tab=${key}`}>{label} <span class="n num">{n}</span></a>)}
          </nav>
          {st.filter ? <span class="faint">Only {st.filter.name} · <a href={`/review?tab=${m.tab}`}>show every collection</a></span> : null}
        </div>
        {st.dryRun && pending ? (
          <p class="callout note"><b>You’re approving everything first.</b> Changes set to Automatic wait here too. Approving a change applies it straight away, or on the day its collection appears. <a href="/settings/approvals">Approval settings</a></p>
        ) : null}
        {m.groups.length === 0 ? (
          pending && st.running ? (
            // While a run is going, the page asks again every few seconds, so the changes show up when it finishes.
            <div class="empty" id="inbox-wait" hx-get={`/review${st.filter ? `?def=${st.filter.id}` : ''}`} hx-trigger="every 4s" hx-select="#main" hx-target="#main" hx-swap="outerHTML">
              <h3><span class="btn loading bare" aria-hidden="true"></span> A run is in progress</h3>
              <p>It’s reading your library and lists. Changes to approve appear here when it finishes; this page updates by itself.</p>
            </div>
          ) : pending && !st.hasRun ? (
            <div class="empty">
              <h3>Nothing to approve yet</h3>
              <p>The first run reads your library and lists and works out what to change. Nothing changes in Jellyfin until you approve it here.</p>
              <form method="post" action="/runs"><Csrf token={csrf} /><input type="hidden" name="next" value="/review" /><button class="btn primary" type="submit"><Icon name="play" /> Run now</button></form>
            </div>
          ) : (
            <div class="empty">
              <h3>{pending ? 'You’re all caught up' : m.tab === 'snoozed' ? 'Nothing snoozed' : 'Nothing dismissed'}</h3>
              <p>{pending
                ? `New changes appear here after each run${st.nextRun ? ` (next: ${st.nextRun})` : ''}. A collection is planned ${st.leadDays} ${st.leadDays === 1 ? 'day' : 'days'} before it appears, so you can approve it ahead of time.`
                : m.tab === 'snoozed' ? 'A snoozed change comes back here when its time is up.' : 'A dismissed change isn’t suggested again unless you bring it back.'}</p>
            </div>
          )
        ) : (
          <form method="post" action="/review">
            <Csrf token={csrf} />
            <input type="hidden" name="tab" value={m.tab} />
            {st.filter ? <input type="hidden" name="def" value={String(st.filter.id)} /> : null}
            {pending ? (
              <div class="bulk" role="region" aria-label="Ticked changes">
                <label class="check js-only" hidden><input type="checkbox" data-check-all="ids" /> <b>Select all</b></label>
                <b class="no-js">Ticked:</b>
                <button class="btn sm primary" type="submit" name="verdict" value="approve"><Icon name="check" /> Approve</button>
                <label class="sr" for="snz">Snooze for</label>
                <select id="snz" name="snooze"><option value="window">Until its collection appears</option><option value="7d">7 days</option><option value="30d">30 days</option></select>
                <button class="btn sm" type="submit" name="verdict" value="snooze"><Icon name="clock" /> Snooze</button>
                <span class="isolate"><button class="btn sm danger" type="submit" name="verdict" value="dismiss" title="Don’t suggest these again"><Icon name="x" /> Dismiss</button></span>
              </div>
            ) : null}
            <div class="table-wrap">
              <table class="tt">
                <thead><tr>{pending ? <th class="cb" scope="col"><span class="sr">Select</span></th> : null}<th scope="col">Title</th><th scope="col">Change</th><th scope="col" class="hide-sm">Why</th><th scope="col" class="r"><span class="sr">Decide</span></th></tr></thead>
                <tbody>
                  {m.groups.map((g) => {
                    const all = [...g.byType.values()].flat();
                    const open = all.filter((a) => a.status === 'proposed');
                    const gid = g.def?.id ?? 0;
                    return (
                      <>
                        <tr class="grp"><th colspan={cols} scope="rowgroup">
                          <span class="grp-head">
                            {pending && open.length ? <input type="checkbox" class="js-only" hidden data-check-group={String(gid)} aria-label={`Select every change for ${g.def?.name ?? 'other changes'}`} /> : null}
                            {g.def ? <a href={`/collections/${g.def.id}`}>{g.def.name}</a> : 'Other'}
                            <span class="sub num">{plural(all.length, 'change')}</span>
                            {pending && g.def && open.length > 1 ? <button class="btn sm" type="submit" name="group" value={`approve:${g.def.id}`}><Icon name="check" /> Approve all {open.length}</button> : null}
                          </span>
                        </th></tr>
                        {[...g.byType.entries()].map(([type, rows]) => (
                          <>
                            <tr class="sub"><th colspan={cols}>{CHANGE_LABEL[type] ?? type} · {rows.length}</th></tr>
                            {rows.map((a) => {
                              const approvedWaiting = a.status === 'approved';
                              const suggested = (a.payload as { suggested?: boolean } | null)?.suggested;
                              const title = a.item?.name ?? (type === 'collection.update_metadata' ? 'Name, sort title, description, poster' : g.def?.name ?? '');
                              return (
                                <tr class={approvedWaiting ? 'sel' : ''}>
                                  {pending ? <td class="cb">{approvedWaiting ? null : <input type="checkbox" name="ids" value={String(a.id)} data-group={String(gid)} aria-label={`Select ${title}`} />}</td> : null}
                                  <td><b>{title}</b>{a.item?.year ? <span class="muted num"> {a.item.year}</span> : null}<br />
                                    <span class="faint">{approvedWaiting ? `Approved · happens ${fmtDate(a.applyAt, tz)} ${fmtTime(a.applyAt, tz)}` : a.applyAt && a.applyAt > Date.now() ? `Happens when the collection appears, ${fmtDate(a.applyAt, tz)}` : a.reason}</span></td>
                                  <td><span class={TAKES_AWAY.has(type) ? 'act-rem' : 'act-add'}><Icon name={TAKES_AWAY.has(type) ? 'minus' : 'plus'} />{CHANGE_VERB[type] ?? 'Update'}</span>{suggested ? <> <span class="chip">suggested</span></> : null}</td>
                                  <td class="hide-sm">{a.item?.provenance?.sources.map((s) => <span class="chip">{s.label} #{s.rank}</span>)}{a.item?.provenance?.match && a.item.provenance.sources.length ? <span class="chip">{a.item.provenance.match}</span> : null}{!a.item ? <span class="faint">{a.reason}</span> : null}</td>
                                  <td><div class="act">
                                    {pending && !approvedWaiting ? (
                                      <>
                                        <button class="btn sm" type="submit" name="only" value={`approve:${a.id}`} aria-label={`Approve ${title}`}><Icon name="check" /> <span class="hide-md">Approve</span></button>
                                        <button class="btn sm ghost" type="submit" name="only" value={`snooze:${a.id}`} aria-label={`Snooze ${title}`} title="Ask again later"><Icon name="clock" /> <span class="hide-md">Snooze</span></button>
                                        <button class="btn sm ghost" type="submit" name="only" value={`dismiss:${a.id}`} aria-label={`Dismiss ${title}`} title="Don’t suggest this again"><Icon name="x" /> <span class="hide-md">Dismiss</span></button>
                                      </>
                                    ) : null}
                                    {!pending ? <button class="btn sm" type="submit" name="only" value={`forget:${a.id}`} title="The next run lists it again"><Icon name="undo" /> Bring back</button> : null}
                                  </div></td>
                                </tr>
                              );
                            })}
                          </>
                        ))}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </form>
        )}
      </div>
    </>
  );
};
