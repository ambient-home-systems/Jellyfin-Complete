// Logger that never prints a secret: every registered secret value is replaced before output (ADR-022).
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const secretValues = new Set<string>();
let minLevel: Level = (['debug', 'info', 'warn', 'error'].includes(process.env.LOG_LEVEL ?? '') ? process.env.LOG_LEVEL : 'info') as Level;
type Sink = (line: string) => void;
const sinks = new Set<Sink>();

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) secretValues.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const v of secretValues) if (out.includes(v)) out = out.split(v).join('«redacted»');
  // Belt and braces: API-key-looking query parameters.
  return out.replace(/([?&](?:api_?key|apikey|token|X-Plex-Token)=)[^&\s"']+/gi, '$1«redacted»');
}

export function setLogLevel(level: Level): void {
  minLevel = level;
}

/** Capture log lines (e.g. into a run log) until the returned function is called. */
export function addSink(sink: Sink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

function fmt(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: Level, args: unknown[]): void {
  const line = redact(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${args.map(fmt).join(' ')}`);
  for (const sink of sinks) sink(line);
  if (ORDER[level] < ORDER[minLevel]) return;
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const log = {
  debug: (...a: unknown[]) => write('debug', a),
  info: (...a: unknown[]) => write('info', a),
  warn: (...a: unknown[]) => write('warn', a),
  error: (...a: unknown[]) => write('error', a),
};
