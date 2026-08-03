import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync('dist', { recursive: true });

// Main process — CJS, keep native/electron modules external
await build({
  entryPoints: ['src/main/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/main.js',
  sourcemap: true,
  external: ['electron', 'uiohook-napi'],
});

// Preload — CJS (sandboxed preload requires CJS)
await build({
  entryPoints: ['src/main/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/preload.js',
  sourcemap: true,
  external: ['electron'],
});

// Renderer — React browser bundle. The tsconfig carries the JSX setting and the
// @/ and @shared/ path aliases, so esbuild and tsc resolve imports identically.
await build({
  entryPoints: ['src/renderer/main.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: 'dist/renderer.js',
  sourcemap: true,
  tsconfig: 'tsconfig.renderer.json',
  // React ships its development and production builds behind this flag. Without
  // the define it resolves to undefined and the overlay bundles the dev build —
  // dev-only warnings, a slower reconciler, and a noticeably larger bundle.
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Renderer styles — Tailwind compiles the token layer plus every utility the
// components actually use into one stylesheet. The CSP allows no network, so
// this file and the fonts below are the whole styling story.
const tailwind = join(root, 'node_modules', '.bin', 'tailwindcss');
execFileSync(
  process.platform === 'win32' ? `${tailwind}.cmd` : tailwind,
  ['--input', 'src/renderer/styles/globals.css', '--output', 'dist/style.css', '--minify'],
  { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' },
);

cpSync('src/renderer/index.html', 'dist/index.html');

// Bundled fonts — the overlay's CSP has no network access, so the typefaces
// ship as local woff2 files referenced by @font-face in globals.css
mkdirSync('dist/fonts', { recursive: true });
for (const f of [
  '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2',
  '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2',
  '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2',
  '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
  '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2',
]) {
  cpSync(`node_modules/${f}`, `dist/fonts/${f.split('/').pop()}`);
}
console.log('build ok');
