const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const { spawn } = require('child_process');

const STAGING_DIR_NAME = 'update-staging';

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function parseRepoFromPackageJson() {
  try {
    const pkg = require(path.join(app.getAppPath(), 'package.json'));
    const url = pkg.repository?.url || pkg.repository || '';
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch {
    return null;
  }
}

class Updater {
  constructor() {
    const repoInfo = parseRepoFromPackageJson();
    this.owner = repoInfo?.owner;
    this.repo = repoInfo?.repo;
    this.stagingDir = path.join(app.getPath('userData'), STAGING_DIR_NAME);
    this.lastCheckResult = null;
  }

  getCurrentVersion() {
    return app.getVersion();
  }

  async checkForUpdate() {
    if (!this.owner || !this.repo) {
      return { updateAvailable: false, error: 'repository_not_configured' };
    }

    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;
      const response = await net.fetch(url, {
        headers: { 'User-Agent': `noty-mac/${this.getCurrentVersion()}` }
      });

      if (response.status === 404) {
        return { updateAvailable: false, error: 'no_releases' };
      }

      if (response.status === 403) {
        return { updateAvailable: false, error: 'rate_limited' };
      }

      if (!response.ok) {
        return { updateAvailable: false, error: `http_${response.status}` };
      }

      const release = await response.json();
      const latestVersion = (release.tag_name || '').replace(/^v/, '');

      if (!/^\d+\.\d+\.\d+/.test(latestVersion)) {
        return { updateAvailable: false, error: 'invalid_version_tag' };
      }

      if (compareVersions(latestVersion, this.getCurrentVersion()) <= 0) {
        return { updateAvailable: false };
      }

      const asarAsset = release.assets?.find(a => a.name === 'app.asar');
      if (!asarAsset) {
        return { updateAvailable: false, error: 'no_asar_asset' };
      }

      this.lastCheckResult = {
        updateAvailable: true,
        latestVersion,
        releaseNotes: release.body || '',
        downloadUrl: asarAsset.browser_download_url,
        assetSize: asarAsset.size
      };

      return this.lastCheckResult;
    } catch (err) {
      return { updateAvailable: false, error: 'network_error' };
    }
  }

  async downloadUpdate(onProgress) {
    const downloadUrl = this.lastCheckResult?.downloadUrl;
    if (!downloadUrl) {
      return { success: false, error: 'no_download_url' };
    }

    fs.mkdirSync(this.stagingDir, { recursive: true });
    const stagedPath = path.join(this.stagingDir, 'app.asar.new');

    try {
      const response = await net.fetch(downloadUrl, {
        headers: { 'User-Agent': `noty-mac/${this.getCurrentVersion()}` }
      });

      if (!response.ok) {
        return { success: false, error: `http_${response.status}` };
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const reader = response.body.getReader();
      const writeStream = fs.createWriteStream(stagedPath);

      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writeStream.write(Buffer.from(value));
        received += value.byteLength;

        if (contentLength > 0 && onProgress) {
          onProgress(Math.round((received / contentLength) * 100));
        }
      }

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        writeStream.end();
      });

      const stat = fs.statSync(stagedPath);
      if (stat.size === 0) {
        fs.unlinkSync(stagedPath);
        return { success: false, error: 'empty_download' };
      }

      return { success: true, path: stagedPath, size: stat.size };
    } catch (err) {
      try { fs.unlinkSync(stagedPath); } catch {}
      return { success: false, error: err.message || 'download_failed' };
    }
  }

  applyUpdate() {
    const stagedAsar = path.join(this.stagingDir, 'app.asar.new');
    if (!fs.existsSync(stagedAsar)) {
      return { success: false, error: 'no_staged_update' };
    }

    const asarTarget = path.join(process.resourcesPath, 'app.asar');
    const backupPath = path.join(this.stagingDir, 'app.asar.backup');
    const appPath = path.resolve(process.resourcesPath, '..', '..');
    const scriptPath = path.join(this.stagingDir, 'swap.sh');

    try {
      fs.accessSync(process.resourcesPath, fs.constants.W_OK);
    } catch {
      return { success: false, error: 'read_only_volume' };
    }

    fs.copyFileSync(asarTarget, backupPath);

    const script = `#!/bin/bash
sleep 2
if cp -f "${stagedAsar}" "${asarTarget}"; then
  xattr -cr "${asarTarget}" 2>/dev/null
  rm -f "${stagedAsar}"
  rm -f "${scriptPath}"
  open "${appPath}"
else
  cp -f "${backupPath}" "${asarTarget}"
  rm -f "${stagedAsar}"
  rm -f "${scriptPath}"
  open "${appPath}"
fi
`;

    fs.writeFileSync(scriptPath, script, { mode: 0o755 });

    const child = spawn('/bin/bash', [scriptPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    app.exit(0);
  }

  cleanupStagingDir() {
    try {
      const backup = path.join(this.stagingDir, 'app.asar.backup');
      const script = path.join(this.stagingDir, 'swap.sh');
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      if (fs.existsSync(script)) fs.unlinkSync(script);
    } catch {}
  }
}

module.exports = Updater;
