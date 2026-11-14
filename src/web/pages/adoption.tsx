/** @jsxImportSource hono/jsx */
// Collections → Already in Jellyfin: collections Jellyfin had before this app, under a name one of yours uses.
import type { FC } from 'hono/jsx';
import { Csrf } from '../ui.js';
import type { AdoptionCandidate } from '../../pipeline/adoption.js';
import { CollectionsTabs } from './collections.js';

export const Adoption: FC<{ items: AdoptionCandidate[]; csrf: string; error?: string | null }> = ({ items, csrf, error }) => {
  const suggested = items.filter((b) => b.suggestion === 'adopt' && b.definitionId).length;
  return (
    <>
      <header class="top">
        <h1>Collections</h1>
        <CollectionsTabs at="existing" />
      </header>
      <div class="content">
        <div class="intro">
          <p class="lead">Collections Jellyfin already had, under the same name as one of yours. The app leaves each alone until you take it over or delete it.</p>
          <details class="how">
            <summary>What taking over means</summary>
            <ul class="plain-list">
              <li><b>Take over.</b> The app starts keeping that collection up to date: its titles, name, poster and dates. What changes goes through your Inbox first. (Jellyfin calls a collection a “box set”.)</li>
              <li><b>Delete.</b> The collection is removed from Jellyfin, and the app makes its own when the time comes. The titles stay in your library.</li>
              <li><b>Made by another tool?</b> Stop that tool making it first, or it will keep rewriting it. For Jellyfin-Auto-Collections, remove its line from config.yaml.</li>
              <li>Also listed: Jellyfin’s own collection for one of your movie series, and collections under an older name for one of yours.</li>
            </ul>
          </details>
        </div>
        {error ? <p role="alert" class="callout err">{error}</p> : null}
        {suggested > 1 ? (
          <form method="post" action="/adoption/adopt-all" class="inline-form">
            <Csrf token={csrf} />
            <button class="btn primary" type="submit">Take over all {suggested} suggested</button>
          </form>
        ) : null}
        {items.length === 0 ? (
          <div class="empty"><h3>Nothing to do here</h3><p>Jellyfin has no collection with the same name as one of yours.</p></div>
        ) : (
          <div class="table-wrap">
            <table class="tt">
              <thead><tr><th scope="col">In Jellyfin</th><th scope="col" class="r">Titles</th><th scope="col" class="hide-sm">Why it’s listed</th><th scope="col" class="r"><span class="sr">Decide</span></th></tr></thead>
              <tbody>
                {items.map((b) => (
                  <tr>
                    <td><b>{b.name}</b>{b.jac ? <> <span class="chip">Jellyfin-Auto-Collections</span></> : null}{b.definitionName && b.definitionName !== b.name ? <><br /><span class="faint">for {b.definitionName}</span></> : null}</td>
                    <td class="r num">{b.childCount ?? '—'}</td>
                    <td class="hide-sm">{b.why}</td>
                    <td><div class="act">
                      {b.definitionId && b.suggestion === 'adopt' ? (
                        <form method="post" action="/adoption/adopt" class="inline-form"><Csrf token={csrf} /><input type="hidden" name="boxsetId" value={b.boxsetId} /><input type="hidden" name="definitionId" value={String(b.definitionId)} /><button class="btn sm primary" type="submit">Take over</button></form>
                      ) : null}
                      <form method="post" action="/adoption/delete" class="inline-form isolate"><Csrf token={csrf} /><input type="hidden" name="boxsetId" value={b.boxsetId} /><button class="btn sm danger" type="submit">Delete from Jellyfin</button></form>
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
};
