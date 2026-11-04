/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Bare, Logo } from '../ui.js';

export const Login: FC<{ error?: string | null; server?: string }> = ({ error, server }) => (
  <Bare title="Sign in">
    <form method="post" action="/login">
      <div class="auth-brand"><Logo size={56} /><h1>Maverick Jellyfin Complete</h1></div>
      <p>Sign in with a Jellyfin administrator account{server ? ` on ${server}` : ''}.</p>
      {error ? <p class="err" role="alert" style="color:var(--red)">{error}</p> : null}
      <div class="field"><label for="u">Username</label><input id="u" name="username" type="text" autocomplete="username" required /></div>
      <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" /></div>
      <button class="btn primary" type="submit">Sign in</button>
    </form>
  </Bare>
);

export const Setup: FC<{ error?: string | null; url?: string; needsCode?: boolean }> = ({ error, url, needsCode }) => (
  <Bare title="Connect Jellyfin">
    <form method="post" action="/setup">
      <div class="auth-brand"><Logo size={56} /><h1>Connect Jellyfin</h1></div>
      <p>First run: tell the app where Jellyfin is. Create an API key in Jellyfin under Dashboard → API Keys. After this, sign in with a Jellyfin administrator account. Dry run is on, so nothing changes until you approve it.</p>
      {error ? <p role="alert" style="color:var(--red)">{error}</p> : null}
      <div class="field"><label for="url">Jellyfin address</label><input id="url" name="url" type="url" value={url ?? ''} placeholder="http://your-server:8096" required /></div>
      <div class="field"><label for="key">API key</label><input id="key" name="apiKey" type="password" autocomplete="off" required /></div>
      {needsCode ? (
        <div class="field"><label for="code">Setup code</label><input id="code" name="setupCode" type="text" autocomplete="off" required placeholder="XXXX-XXXX" class="num" /><span class="hint">Printed in this app’s log when it starts, for example with <code>docker logs maverick-jellyfin-complete</code>. It stops anyone else who can reach this page from connecting it first.</span></div>
      ) : null}
      <button class="btn primary" type="submit">Test and save</button>
    </form>
  </Bare>
);
