/** @jsxImportSource hono/jsx */
// Settings → Claude access (ADR-032): access tokens for the MCP endpoint, and how to connect Claude Code or Claude Desktop.
import type { FC } from 'hono/jsx';
import { Icon, Csrf, fmtDate, fmtAgo } from '../ui.js';
import { SCOPE_LABEL, type ApiToken, type TokenScope } from '../api-tokens.js';

export type Reveal = { name: string; token: string; scope: TokenScope };

/** Claude Desktop runs local MCP servers only; mcp-remote bridges it to this HTTP endpoint with the token as a header. */
function desktopConfig(endpoint: string, token: string): string {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(endpoint);
  const args = ['-y', 'mcp-remote', endpoint, ...(endpoint.startsWith('http:') && !local ? ['--allow-http'] : []), '--header', 'Authorization:${AUTH_HEADER}'];
  return JSON.stringify({ mcpServers: { maverick: { command: 'npx', args, env: { AUTH_HEADER: `Bearer ${token}` } } } }, null, 2);
}

export const ClaudeAccess: FC<{ tokens: ApiToken[]; reveal: Reveal | null; endpoint: string; tz: string; csrf: string }> = ({ tokens, reveal, endpoint, tz, csrf }) => (
  <section class="form-sec" id="claude" aria-labelledby="claude-h">
    <div class="section-head"><h2 id="claude-h">Claude access</h2><span class="aside">MCP, from a computer on your network</span></div>
    <p class="muted">
      Let Claude Code or Claude Desktop use this app: ask what’s coming up, what’s waiting in your Inbox, or why a title is missing.
      With <b>Read, review and run</b>, Claude can also approve, snooze or dismiss changes and start a run; with <b>Full control</b>, everything else too, except connections, keys and these tokens.
      Approving applies the change to Jellyfin straight away, as it does in your Inbox.
    </p>

    {reveal ? (
      <div class="reveal" role="status">
        <p><b>Token “{reveal.name}” created ({SCOPE_LABEL[reveal.scope]}).</b> Copy it now: it isn’t shown again.</p>
        <pre class="logbox copy">{reveal.token}</pre>
        <p class="hint"><b>Claude Code:</b> run this on the computer where you use Claude Code.</p>
        <pre class="logbox copy">{`claude mcp add --transport http maverick ${endpoint} --header "Authorization: Bearer ${reveal.token}"`}</pre>
        <p class="hint"><b>Claude Desktop:</b> add this to <code>claude_desktop_config.json</code> (Settings → Developer → Edit config), then restart Claude Desktop. It needs Node.js on that computer.</p>
        <pre class="logbox copy">{desktopConfig(endpoint, reveal.token)}</pre>
      </div>
    ) : null}

    {tokens.length ? (
      <div class="table-wrap">
        <table class="tt">
          <thead><tr><th scope="col">Name</th><th scope="col">Access</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col"><span class="sr">Revoke</span></th></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr>
                <td><b>{t.name}</b><br /><span class="faint num">mjc_…{t.hint}</span></td>
                <td>{SCOPE_LABEL[t.scope]}</td>
                <td class="num">{fmtDate(t.createdAt, tz)}<br /><span class="faint">by {t.createdBy}</span></td>
                <td class="num">{t.lastUsedAt ? fmtAgo(t.lastUsedAt) : <span class="faint">never</span>}</td>
                <td>
                  <form method="post" action={`/settings/claude/${t.id}/revoke`} class="inline-form">
                    <Csrf token={csrf} />
                    <button class="btn sm danger" type="submit" aria-label={`Revoke ${t.name}`}><Icon name="trash" /> Revoke</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : <p class="faint">No tokens yet. Claude can’t connect until you create one.</p>}

    <form method="post" action="/settings/claude" class="form" style="margin-top:var(--s4)">
      <Csrf token={csrf} />
      <div class="field">
        <label for="tok-name">Token name</label>
        <input id="tok-name" name="name" type="text" required maxlength={60} placeholder="e.g. Claude Code on my laptop" />
        <span class="hint">Name it after where it’s used, so you know which one to revoke.</span>
      </div>
      <div class="choice" role="radiogroup" aria-label="Access">
        <label><input type="radio" name="scope" value="review" checked /><b>{SCOPE_LABEL.review}</b><span>Everything Read only allows, plus approving, snoozing or dismissing changes in your Inbox, and starting a run.</span></label>
        <label><input type="radio" name="scope" value="full" /><b>{SCOPE_LABEL.full}</b><span>Everything the app’s pages can do: settings and schedules; creating, editing and deleting collections, with their dates, filters and sources; collections already in Jellyfin; undo; Radarr and Sonarr. Not connections, keys or these tokens.</span></label>
        <label><input type="radio" name="scope" value="read" /><b>{SCOPE_LABEL.read}</b><span>Status, settings, collections, the Inbox and History. Can’t change anything.</span></label>
      </div>
      <div><button class="btn primary" type="submit"><Icon name="plus" /> Create token</button></div>
    </form>
    <p class="hint" style="margin-top:var(--s3)">Endpoint: <code>{endpoint}</code>. Connections and keys stay on these Settings pages: Claude can’t see or change them, so a leaked token can’t send your keys elsewhere.</p>
  </section>
);
