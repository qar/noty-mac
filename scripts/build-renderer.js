// Renderer bundle build script.
// Runs after tsc (see package.json build chain). Bundles src/renderer/main.ts
// into a single IIFE for the main window, then copies main.html + main.css
// into dist/renderer so the loaded HTML can reference the bundle and CSS by
// bare filename.
//
// esbuild handles the TypeScript-to-JavaScript transform inline; a separate
// `tsc --noEmit -p tsconfig.renderer.json` typechecks renderer/*.ts.

const esbuild = require('esbuild');
const { promises: fs } = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'dist', 'renderer');
const srcDir = path.join(projectRoot, 'src', 'renderer');

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(srcDir, 'main.ts')],
    bundle: true,
    outfile: path.join(outDir, 'main.bundle.js'),
    format: 'iife',
    // Electron 28 ships Chromium 120. Matching narrows the transform surface.
    target: 'chrome120',
    sourcemap: true,
    logLevel: 'info',
  });

  // Copy the static assets used by the main window renderer.
  await fs.copyFile(
    path.join(srcDir, 'main.html'),
    path.join(outDir, 'main.html')
  );
  await fs.copyFile(
    path.join(srcDir, 'main.css'),
    path.join(outDir, 'main.css')
  );
}

main().catch((err) => {
  console.error('[build-renderer] failed:', err);
  process.exit(1);
});
