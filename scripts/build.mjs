import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

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

// Renderer — browser bundle
await build({
  entryPoints: ['src/renderer/renderer.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: 'dist/renderer.js',
  sourcemap: true,
});

cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('src/renderer/style.css', 'dist/style.css');

// Bundled fonts — the overlay's CSP has no network access, so the typefaces
// ship as local woff2 files referenced by @font-face in style.css
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
