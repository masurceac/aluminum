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
console.log('build ok');
