// AI-integration wizard (Settings > AI 集成).
//
// The whole purpose of this module is to describe user-owned filesystem
// state (whether noty-status is on PATH, whether the CLAUDE.md snippet is
// installed) and produce copy-pasteable strings. It never writes anywhere
// outside the clipboard.
//
// Red line (docs/workspace-mvp.md §11 + docs/agent-status.md):
//   - We do NOT write to `~/.local/bin/` or any PATH directory.
//   - We do NOT write to `~/.claude/` in any form.
//   - We do NOT modify user shell rc files.
// Any change to that policy has to go through a design-doc PR first.

import { app } from 'electron';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';

const NOTY_STATUS_FILENAME = 'noty-status';
const CLAUDE_MD_SNIPPET_ASSET = 'claude-md-snippet.md';
const CLAUDE_MD_MARKER_BEGIN = '<!-- BEGIN NOTY-STATUS';

/** Candidate install locations in PATH-priority order. */
const CANDIDATE_LOCATIONS = [
  path.join(os.homedir(), '.local', 'bin', NOTY_STATUS_FILENAME),
  path.join(os.homedir(), 'bin', NOTY_STATUS_FILENAME),
  '/usr/local/bin/' + NOTY_STATUS_FILENAME,
  '/opt/homebrew/bin/' + NOTY_STATUS_FILENAME,
];

const RECOMMENDED_TARGET = CANDIDATE_LOCATIONS[0];

export interface InstalledInfo {
  /** Absolute path where a `noty-status` binary was found; null if none. */
  at: string | null;
  /** True when `at` is a symlink pointing at OUR bundled script. False when
   *  it's a symlink elsewhere or a plain file (probably the user's own). */
  isOurs: boolean;
}

export interface ClaudeMdInfo {
  /** `~/.claude/CLAUDE.md` (returned even when the file doesn't exist so
   *  the UI can show the target path). */
  path: string;
  exists: boolean;
  /** True iff the file contains our BEGIN NOTY-STATUS marker. */
  snippetInstalled: boolean;
}

export interface IntegrationSnapshot {
  /** Absolute path to the `noty-status` script we ship. */
  scriptSourcePath: string;
  /** One-liner the user can paste into their shell to install. */
  installCommand: string;
  installed: InstalledInfo;
  claudeMd: ClaudeMdInfo;
  /** Full text of the recommended CLAUDE.md snippet. */
  snippet: string;
}

// -----------------------------------------------------------------------
// Script source resolution
//
// Packaged builds: `electron-builder.json.extraResources` copies
// `scripts/noty-status` to `<AppBundle>/Contents/Resources/noty-status`,
// which Electron exposes at `process.resourcesPath`.
//
// Dev: fall back to the tree.
// -----------------------------------------------------------------------
function resolveScriptSource(): string {
  const packaged = path.join(process.resourcesPath, NOTY_STATUS_FILENAME);
  if (fsSync.existsSync(packaged)) return packaged;
  return path.join(app.getAppPath(), 'scripts', NOTY_STATUS_FILENAME);
}

// -----------------------------------------------------------------------
// Installed detection
// -----------------------------------------------------------------------
function detectInstalled(scriptSourcePath: string): InstalledInfo {
  const sourceReal = safeRealpath(scriptSourcePath);

  for (const loc of CANDIDATE_LOCATIONS) {
    let stat: fsSync.Stats;
    try {
      stat = fsSync.lstatSync(loc);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink() && !stat.isFile()) {
      continue;
    }

    let isOurs = false;
    if (stat.isSymbolicLink()) {
      try {
        const target = fsSync.readlinkSync(loc);
        const resolved = path.isAbsolute(target)
          ? target
          : path.resolve(path.dirname(loc), target);
        const resolvedReal = safeRealpath(resolved);
        isOurs = resolvedReal !== null && resolvedReal === sourceReal;
      } catch {
        // fall through — leave isOurs = false
      }
    }

    return { at: loc, isOurs };
  }

  return { at: null, isOurs: false };
}

function safeRealpath(p: string): string | null {
  try {
    return fsSync.realpathSync(p);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------
// CLAUDE.md snippet detection
// -----------------------------------------------------------------------
async function detectClaudeMd(): Promise<ClaudeMdInfo> {
  const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  let content: string;
  try {
    content = await fs.readFile(claudeMdPath, 'utf-8');
  } catch {
    return { path: claudeMdPath, exists: false, snippetInstalled: false };
  }
  return {
    path: claudeMdPath,
    exists: true,
    snippetInstalled: content.includes(CLAUDE_MD_MARKER_BEGIN),
  };
}

// -----------------------------------------------------------------------
// Snippet loader
// -----------------------------------------------------------------------
async function readSnippet(): Promise<string> {
  // Snippet is a static asset shipped inside the asar. app.getAppPath()
  // resolves to the asar root at runtime, and fs.readFile transparently
  // reads from it.
  const assetPath = path.join(
    app.getAppPath(),
    'assets',
    CLAUDE_MD_SNIPPET_ASSET
  );
  try {
    return await fs.readFile(assetPath, 'utf-8');
  } catch (err) {
    console.warn('[integration] failed to read snippet asset:', err);
    return '';
  }
}

// -----------------------------------------------------------------------
// Install command
// -----------------------------------------------------------------------
function buildInstallCommand(scriptSourcePath: string): string {
  // Quote source path so spaces in "Application Support" style paths survive.
  const quoted = shellQuote(scriptSourcePath);
  return `mkdir -p ~/.local/bin && ln -sf ${quoted} ~/.local/bin/noty-status`;
}

function shellQuote(s: string): string {
  // Single-quote and escape existing single-quotes.
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// -----------------------------------------------------------------------
// Public: assemble the snapshot the renderer shows.
// -----------------------------------------------------------------------
export async function snapshot(): Promise<IntegrationSnapshot> {
  const scriptSourcePath = resolveScriptSource();
  const installed = detectInstalled(scriptSourcePath);
  const [claudeMd, snippet] = await Promise.all([
    detectClaudeMd(),
    readSnippet(),
  ]);
  return {
    scriptSourcePath,
    installCommand: buildInstallCommand(scriptSourcePath),
    installed,
    claudeMd,
    snippet,
  };
}

/** Where the wizard recommends the user link the script (for UI copy). */
export function recommendedTarget(): string {
  return RECOMMENDED_TARGET;
}
