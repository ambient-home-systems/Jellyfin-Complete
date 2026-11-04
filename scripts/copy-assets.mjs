// Build step: make sure the vendored htmx in public/ matches the installed package.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/vendor', { recursive: true });
copyFileSync('node_modules/htmx.org/dist/htmx.min.js', 'public/vendor/htmx.min.js');
