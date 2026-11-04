#!/usr/bin/env node
// Privacy check for the public export (docs/RELEASE-CHECKLIST.md). Scans every text file under a directory for
// things that identify a person, household or server, and for relative links that point at excluded files.
//
//   node scripts/privacy-check.mjs <dir> [--denylist <file>]
//
// The denylist holds your own literal strings (names, addresses, library names, paths), one per line, # for
// comments. Keep it OUTSIDE the repository, or in the gitignored `.privacy-denylist`: it is private by definition.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const root = args[0];
if (!root) {
  console.error('Usage: node scripts/privacy-check.mjs <dir> [--denylist <file>]');
  process.exit(2);
}
const i = args.indexOf('--denylist');
const denyFile = i >= 0 ? args[i + 1] : existsSync(join(root, '.privacy-denylist')) ? join(root, '.privacy-denylist') : null;
const deny = denyFile ? readFileSync(denyFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];

const RULES = [
  { name: 'private IPv4 address', re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g },
  { name: 'email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, allow: /@(?:users\.noreply\.github\.com|noreply\.github\.com|example\.(?:com|org)|anthropic\.com)$/i },
  { name: 'home directory path', re: /(?:^|[\s"'`(=])(\/root\/[\w.-]+|\/home\/[a-z][\w.-]*\/[\w.-]+|~\/[\w.-]+\/[\w.-]+)/g, allow: /\/home\/user\/|~\/\.(?:ccr|config)/ },
  { name: 'Claude session link', re: /claude\.ai\/code\/session_[\w-]+/g },
];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);
const findings = [];
let scanned = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.isFile() && name !== '.privacy-denylist') check(p);
  }
}

function check(file) {
  const buf = readFileSync(file);
  if (buf.includes(0)) return; // binary
  scanned++;
  const text = buf.toString('utf8');
  const rel = relative(root, file);
  const lines = text.split('\n');
  lines.forEach((line, n) => {
    for (const r of RULES) {
      for (const m of line.matchAll(r.re)) {
        const hit = (m[1] ?? m[0]).trim();
        if (r.allow && r.allow.test(hit)) continue;
        findings.push(`${rel}:${n + 1}: ${r.name}: ${hit}`);
      }
    }
    for (const d of deny) if (line.toLowerCase().includes(d.toLowerCase())) findings.push(`${rel}:${n + 1}: denylisted: ${d}`);
  });
  // Relative Markdown links must resolve inside the export (excluded files would leave them dangling).
  if (file.endsWith('.md')) {
    for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
      if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) findings.push(`${rel}: link to a missing file: ${target}`);
    }
  }
}

walk(root);
if (findings.length) {
  console.error(`Privacy check FAILED: ${findings.length} finding(s) in ${scanned} files${denyFile ? ` (denylist: ${deny.length} entries)` : ''}:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Privacy check passed: ${scanned} text files${denyFile ? `, ${deny.length} denylisted strings` : ', no denylist'}.`);
