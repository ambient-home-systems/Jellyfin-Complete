/** @jsxImportSource hono/jsx */
// Shared layout and components, matching docs/mockups (Timetable direction, DESIGN.md).
import type { Child, FC } from 'hono/jsx';
import { raw } from 'hono/html';
import { APP_VERSION } from '../config.js';

const ICONS: Record<string, string> = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  collections: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  review: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  activity: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  settings: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  missing: '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  tv: '<rect width="20" height="15" x="2" y="7" rx="2"/><polyline points="17 2 12 7 7 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('')}</svg>`;
export const sprite = () => raw(SPRITE);

export const Icon: FC<{ name: string }> = ({ name }) => (
  <svg class="i" aria-hidden="true"><use href={`#i-${name}`} /></svg>
);

export const Dot: FC<{ state: 'ok' | 'warn' | 'err' | 'live'; label: string }> = ({ state, label }) => (
  <span class={`dot ${state}`} role="img" aria-label={label}></span>
);

export const Seg: FC<{ name: string; value: string; options: [string, string][]; inherit?: boolean; label?: string }> = ({ name, value, options, inherit, label }) => (
  <span class={`seg${inherit ? ' inherit' : ''}`} role="radiogroup" aria-label={label ?? name}>
    {options.map(([v, text]) => {
      const id = `${name}-${v}`.replace(/[^a-z0-9_-]/gi, '-');
      return (
        <>
          <input type="radio" name={name} id={id} value={v} checked={v === value} />
          <label for={id}>{text}</label>
        </>
      );
    })}
  </span>
);

export type NavKey = 'dashboard' | 'collections' | 'review' | 'missing' | 'activity' | 'settings';

export type LayoutProps = {
  title: string;
  nav: NavKey;
  user: { name: string; csrf: string };
  dryRun: boolean;
  pending: number;
  lastRun: string;
  flash?: { kind: 'ok' | 'err'; text: string } | null;
  banner?: Child;
  children?: Child;
};

export const Layout: FC<LayoutProps> = (p) => {
  const nav: [NavKey, string, string, string][] = [
    ['dashboard', '/', 'dashboard', 'Dashboard'],
    ['collections', '/collections', 'collections', 'Collections'],
    ['review', '/review', 'review', 'Review'],
    ['missing', '/missing', 'missing', 'Missing'],
    ['activity', '/activity', 'activity', 'Activity'],
    ['settings', '/settings', 'settings', 'Settings'],
  ];
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${p.title} · Maverick Jellyfin Complete`}</title>
        <link rel="preload" href="/static/fonts/Archivo-latin.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="stylesheet" href="/static/app.css" />
        <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
        <script src="/static/vendor/htmx.min.js" defer></script>
      </head>
      <body hx-headers={JSON.stringify({ 'x-csrf-token': p.user.csrf })}>
        {sprite()}
        <div class="app">
          <aside class="rail" aria-label="Main navigation">
            <div class="brand"><Logo /><span>Maverick<small>Jellyfin Complete</small></span></div>
            <nav>
              {nav.map(([key, href, icon, label]) => (
                <a href={href} aria-current={p.nav === key ? 'page' : undefined}>
                  <Icon name={icon} />
                  <span class="lbl">{label}</span>
                  {key === 'review' && p.pending > 0 ? <span class="count num" aria-label={`${p.pending} waiting`}>{p.pending}</span> : null}
                </a>
              ))}
            </nav>
            <div class="foot">
              <div class="dry">
                <span class={`dot ${p.dryRun ? 'warn' : 'ok'}`}></span>
                <b>{p.dryRun ? 'Dry run on' : 'Dry run off'}</b>
                <span>{p.dryRun ? 'Every action waits in Review' : 'Auto actions apply on their own'}</span>
              </div>
              <div class="who">{p.lastRun} · signed in as {p.user.name}</div>
              <div class="who faint">v{APP_VERSION}</div>
              <form method="post" action="/logout">
                <input type="hidden" name="_csrf" value={p.user.csrf} />
                <button class="linklike who" type="submit">Sign out</button>
              </form>
            </div>
          </aside>
          <main class="main" id="main">
            {p.banner}
            {p.flash ? <div class={`flash ${p.flash.kind}`} role="status">{p.flash.text}</div> : null}
            {p.children}
          </main>
        </div>
      </body>
    </html>
  );
};

export const Csrf: FC<{ token: string }> = ({ token }) => <input type="hidden" name="_csrf" value={token} />;

/** Bare page (sign-in, setup) with the same type and palette. */
/** The split-flap M (docs/logo). Decorative: the name always sits beside it as text. */
export const Logo: FC<{ size?: number }> = ({ size = 30 }) => (
  <span class="logo" style={`width:${size}px;height:${size}px`}>{raw('<svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="12" fill="#ffd200"></rect><path d="M24 74V26h12l14 20 14-20h12v48H65V44L50 64 35 44v30z" fill="#131313"></path><rect x="6" y="48.5" width="88" height="3" fill="#131313"></rect></svg>')}</span>
);

export const Bare: FC<{ title: string; children?: Child }> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{`${title} · Maverick Jellyfin Complete`}</title>
      <link rel="stylesheet" href="/static/app.css" />
      <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
    </head>
    <body>
      <div class="auth">{children}</div>
    </body>
  </html>
);

// ── formatting in the install's timezone ──
export function fmtDate(ms: number | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(ms));
}
export function fmtTime(ms: number | null | undefined, tz: string): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}
export function fmtAgo(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return 'never';
  const mins = Math.round((now - ms) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 120) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
