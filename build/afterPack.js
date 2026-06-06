'use strict';

// electron-builder afterPack hook.
//
// We distribute Noty ad-hoc signed (no Apple Developer ID): the app is launched
// locally and updated via the in-app asar swap, not notarized. With
// `mac.identity: null` electron-builder *skips* signing entirely, which leaves
// the raw linker signature (Identifier=Electron, inconsistent CodeResources) —
// that fails `codesign --verify` and won't launch on Apple Silicon.
//
// So we re-sign the packaged .app ad-hoc here, before the DMG is built, giving a
// valid signature with the real bundle id and hardened runtime OFF. Doing it in
// a hook (instead of relying on a keychain cert) keeps `npm run dist`
// reproducible regardless of which Developer certs happen to be installed —
// notably avoiding the "ambiguous identity" failure when duplicate
// "Apple Development" certs exist in the login keychain.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const bundleId = context.packager.appInfo.id; // com.noty.mac

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--identifier', bundleId, appPath],
    { stdio: 'inherit' }
  );

  console.log(`  • afterPack: ad-hoc signed ${appName} (id=${bundleId})`);
};
