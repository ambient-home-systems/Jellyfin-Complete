// Entry point: config → database → scheduler → HTTP server on :8097 (ADR-005).
import { serve } from '@hono/node-server';
import { loadDotEnv, readConfig } from './config.js';
import { setLogLevel, log } from './log.js';
import { createContext } from './app-context.js';
import { createWeb } from './web/app.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

loadDotEnv();
const config = readConfig();
setLogLevel(config.logLevel);
const app = createContext(config);
const web = createWeb(app, { scheduler: true });
startScheduler(app);

if (app.setupCode) {
  // Anyone who can reach the app before setup could otherwise connect it to their own Jellyfin first.
  log.warn(`First run: open /setup and enter this setup code: ${app.setupCode}`);
}

const server = serve({ fetch: web.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  log.info(`Maverick Jellyfin Complete listening on :${info.port} (config in ${config.configDir}, timezone ${app.settings().timezone})`);
});

function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`);
  stopScheduler();
  server.close(() => {
    app.db.$client.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
