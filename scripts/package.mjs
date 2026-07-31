// Packages the built app into a standalone bundle — Aluminum.app on macOS,
// a portable Aluminum-win32-x64 folder on Windows — so it can be installed
// and run without a dev checkout. Run `npm run build` and `npm run helper`
// first — `npm run package` does both.
//
// Strategy: stage only what the app needs at runtime into a clean directory
// (dist/, assets/, the helper binary, the one native dependency), then hand
// that to @electron/packager. Staging exists because pnpm's node_modules is
// a symlink forest the packager must not see — cpSync dereferences it.
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { packager } from '@electron/packager';

/** real on-disk directory of a package as `from` would resolve it — pnpm
 * keeps transitive deps un-hoisted inside .pnpm, so paths can't be assumed */
const resolvePkgDir = (from, pkg) =>
  dirname(createRequire(join(from, 'noop.js')).resolve(`${pkg}/package.json`));

const platform = process.platform;
if (platform !== 'darwin' && platform !== 'win32') {
  console.error(`package.mjs supports macOS and Windows only (got ${platform})`);
  process.exit(1);
}
const helperBinary = platform === 'win32' ? 'SelectionHelper.exe' : 'SelectionHelper';
if (!existsSync(`helper/${helperBinary}`)) {
  console.error(`helper/${helperBinary} missing — run \`npm run helper\` first`);
  process.exit(1);
}

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const electronVersion = JSON.parse(
  readFileSync('node_modules/electron/package.json', 'utf8'),
).version;

const staging = 'release/staging';
rmSync('release', { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

writeFileSync(
  `${staging}/package.json`,
  JSON.stringify(
    { name: root.name, productName: 'Aluminum', version: root.version, main: 'dist/main.js' },
    null,
    2,
  ),
);
cpSync('dist', `${staging}/dist`, { recursive: true });
cpSync('assets', `${staging}/assets`, { recursive: true });
mkdirSync(`${staging}/helper`, { recursive: true });
cpSync(`helper/${helperBinary}`, `${staging}/helper/${helperBinary}`);
// uiohook-napi requires node-gyp-build at load time to find its prebuilt
// .node binary — both must ship
const uiohookDir = resolvePkgDir(process.cwd(), 'uiohook-napi');
const gypBuildDir = resolvePkgDir(uiohookDir, 'node-gyp-build');
cpSync(uiohookDir, `${staging}/node_modules/uiohook-napi`, { recursive: true, dereference: true });
cpSync(gypBuildDir, `${staging}/node_modules/node-gyp-build`, { recursive: true, dereference: true });

const [appPath] = await packager({
  dir: staging,
  out: 'release',
  name: 'Aluminum',
  appBundleId: 'com.aluminum.app',
  electronVersion,
  icon: platform === 'win32' ? 'assets/icon.ico' : 'assets/icon.icns', // .icns via scripts/gen-icns.sh
  overwrite: true,
  // the staging dir already contains exactly the runtime set — pruning
  // against its dependency-less package.json would empty node_modules
  prune: false,
  // no asar: the helper must be spawnable and uiohook's .node loadable
  // straight from Contents/Resources/app
  asar: false,
  ...(platform === 'darwin'
    ? {
        extendInfo: {
          // menu-bar app: no Dock icon, no app switcher entry (main.ts also calls
          // app.dock.hide(), but LSUIElement avoids even the launch-flash)
          LSUIElement: true,
        },
      }
    : {
        win32metadata: {
          ProductName: 'Aluminum',
          FileDescription: 'Aluminum quick-capture list',
        },
      }),
});

rmSync(staging, { recursive: true, force: true });
console.log(`packaged ${appPath}${platform === 'darwin' ? '/Aluminum.app' : ''}`);
