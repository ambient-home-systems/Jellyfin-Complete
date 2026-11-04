/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Csrf } from '../ui.js';
import type { AdoptionCandidate } from '../../pipeline/adoption.js';

export const Adoption: FC<{ items: AdoptionCandidate[]; csrf: string; error?: string | null }> = ({ items, csrf, error }) => (
  <>
    <header class="top">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/collections">Collections</a><span aria-hidden="true">/</span><span>Existing box sets</span></nav>
      <h1>Existing box sets</h1>
    </header>
    <div class="content">
      <p class="muted" style="max-width:72ch">
        These box sets already exist in Jellyfin with the same name as one of your collections (or an older name for it). The app never touches them unless you adopt them.
        If Jellyfin-Auto-Collections manages one, remove its line from JAC’s config.yaml first, or JAC will keep rewriting it (ADR-009).
      </p>
      {error ? <p role="alert" style="color:var(--red)">{error}</p> : null}
      {items.length === 0 ? (
        <div class="empty"><h3>No matching box sets</h3><p>Nothing in Jellyfin clashes with your collections.</p></div>
      ) : (
        <div class="table-wrap">
          <table class="tt">
            <thead><tr><th scope="col">Box set</th><th scope="col" class="r">Items</th><th scope="col" class="hide-sm">Why it’s listed</th><th scope="col" class="r"><span class="sr">Decide</span></th></tr></thead>
            <tbody>
              {items.map((b) => (
                <tr>
                  <td><b>{b.name}</b>{b.jac ? <> <span class="chip">Jellyfin-Auto-Collections</span></> : null}{b.definitionName && b.definitionName !== b.name ? <><br /><span class="faint">for {b.definitionName}</span></> : null}</td>
                  <td class="r num">{b.childCount ?? '—'}</td>
                  <td class="hide-sm">{b.why}</td>
                  <td><div class="act">
                    {b.definitionId && b.suggestion === 'adopt' ? (
                      <form method="post" action="/adoption/adopt" class="inline-form"><Csrf token={csrf} /><input type="hidden" name="boxsetId" value={b.boxsetId} /><input type="hidden" name="definitionId" value={String(b.definitionId)} /><button class="btn sm primary" type="submit">Adopt</button></form>
                    ) : null}
                    <form method="post" action="/adoption/delete" class="inline-form isolate"><Csrf token={csrf} /><input type="hidden" name="boxsetId" value={b.boxsetId} /><button class="btn sm danger" type="submit">Delete box set</button></form>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  </>
);
