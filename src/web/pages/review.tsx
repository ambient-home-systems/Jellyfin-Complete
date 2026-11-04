/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Icon, Csrf, fmtDate, fmtTime } from '../ui.js';
import type { reviewModel } from '../model.js';

type M = ReturnType<typeof reviewModel>;
const TYPE_LABEL: Record<string, string> = {
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

export const Review: FC<{ m: M; csrf: string; tz: string; dryRun: boolean }> = ({ m, csrf, tz, dryRun }) => {
  const tabs: [string, string, number][] = [['pending', 'Pending', m.counts.proposed ?? 0], ['snoozed', 'Snoozed', m.counts.snoozed ?? 0], ['dismissed', 'Dismissed', m.counts.dismissed ?? 0]];
  const pending = m.tab === 'pending';
  return (
    <>
      {dryRun ? (
        <div class="banner" role="status"><Icon name="info" /><span><b>Dry run is on.</b> Every action waits here, including ones set to Auto. Approving applies it now (or when its window opens).</span><a class="btn sm" href="/settings#run">Dry run settings</a></div>
      ) : null}
      <header class="top">
        <h1>Review</h1>
        <div class="tabs" role="tablist" aria-label="Queue">
          {tabs.map(([key, label, n]) => <a role="tab" aria-selected={m.tab === key ? 'true' : 'false'} href={`/review?tab=${key}`}>{label} <span class="n num">{n}</span></a>)}
        </div>
      </header>
      <div class="content">
        {m.groups.length === 0 ? (
          <div class="empty"><h3>{pending ? 'Nothing waits for review' : `Nothing ${m.tab}`}</h3><p>{pending ? 'New proposals appear here after each run. Windows opening in the next 14 days are planned ahead.' : 'Undo brings an item back to the next run’s plan.'}</p></div>
        ) : (
          <form method="post" action="/review">
            <Csrf token={csrf} />
            <input type="hidden" name="tab" value={m.tab} />
            {pending ? (
              <div class="bulk" role="region" aria-label="Bulk actions">
                <b>Selected</b>
                <button class="btn sm primary" type="submit" name="verdict" value="approve"><Icon name="check" /> Approve</button>
                <label class="sr" for="snz">Snooze for</label>
                <select id="snz" name="snooze"><option value="window">Until its window opens</option><option value="7d">7 days</option><option value="30d">30 days</option></select>
                <button class="btn sm" type="submit" name="verdict" value="snooze"><Icon name="clock" /> Snooze</button>
                <span class="isolate"><button class="btn sm danger" type="submit" name="verdict" value="dismiss"><Icon name="x" /> Dismiss</button></span>
              </div>
            ) : null}
            <div class="table-wrap">
              <table class="tt">
                <thead><tr>{pending ? <th class="cb" scope="col"><span class="sr">Select</span></th> : null}<th scope="col">Title</th><th scope="col">Action</th><th scope="col" class="hide-sm">Why</th><th scope="col" class="r"><span class="sr">Decide</span></th></tr></thead>
                <tbody>
                  {m.groups.map((g) => (
                    <>
                      <tr class="grp"><th colspan={5} scope="rowgroup">{g.def?.name ?? 'Other'}<span class="sub num">{[...g.byType.values()].reduce((n, r) => n + r.length, 0)}</span></th></tr>
                      {[...g.byType.entries()].map(([type, rows]) => (
                        <>
                          <tr class="sub"><th colspan={5}>{TYPE_LABEL[type] ?? type} · {rows.length}</th></tr>
                          {rows.map((a) => {
                            const approvedWaiting = a.status === 'approved';
                            const suggested = (a.payload as { suggested?: boolean } | null)?.suggested;
                            const title = a.item?.name ?? (type === 'collection.update_metadata' ? 'Name, sort title, overview, poster' : g.def?.name ?? '');
                            return (
                              <tr class={approvedWaiting ? 'sel' : ''}>
                                {pending ? <td class="cb">{approvedWaiting ? null : <input type="checkbox" name="ids" value={String(a.id)} aria-label={`Select ${title}`} />}</td> : null}
                                <td><b>{title}</b>{a.item?.year ? <span class="muted num"> {a.item.year}</span> : null}<br />
                                  <span class="faint">{approvedWaiting ? `Approved · applies ${fmtDate(a.applyAt, tz)} ${fmtTime(a.applyAt, tz)}` : a.applyAt && a.applyAt > Date.now() ? `Applies when it opens, ${fmtDate(a.applyAt, tz)}` : a.reason}</span></td>
                                <td><span class={type === 'collection.remove_items' ? 'act-rem' : 'act-add'}><Icon name={type === 'collection.remove_items' || type === 'collection.delete' || type === 'collection.hide' ? 'minus' : 'plus'} />{type === 'collection.add_items' ? 'Add' : type === 'collection.remove_items' ? 'Remove' : type === 'collection.create' ? 'Create' : type === 'collection.delete' ? 'Delete' : type === 'collection.hide' ? 'Hide' : type === 'collection.show' ? 'Show' : type === 'radarr.add_movie' ? 'Radarr' : type === 'sonarr.add_series' ? 'Sonarr' : type === 'radarr.monitor_collection' ? 'Monitor' : 'Update'}</span>{suggested ? <> <span class="chip">suggested</span></> : null}</td>
                                <td class="hide-sm">{a.item?.provenance?.sources.map((s) => <span class="chip">{s.label} #{s.rank}</span>)}{a.item?.provenance?.match && a.item.provenance.sources.length ? <span class="chip">{a.item.provenance.match}</span> : null}{!a.item ? <span class="faint">{a.reason}</span> : null}</td>
                                <td><div class="act">
                                  {pending && !approvedWaiting ? (
                                    <>
                                      <button class="btn sm" type="submit" name="only" value={`approve:${a.id}`} aria-label={`Approve ${title}`}><Icon name="check" /></button>
                                      <button class="btn sm ghost" type="submit" name="only" value={`snooze:${a.id}`} aria-label={`Snooze ${title}`}><Icon name="clock" /></button>
                                      <button class="btn sm ghost" type="submit" name="only" value={`dismiss:${a.id}`} aria-label={`Dismiss ${title}`}><Icon name="x" /></button>
                                    </>
                                  ) : null}
                                  {!pending ? <button class="btn sm" type="submit" name="only" value={`forget:${a.id}`}><Icon name="undo" /> Undo</button> : null}
                                </div></td>
                              </tr>
                            );
                          })}
                        </>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        )}
      </div>
    </>
  );
};
