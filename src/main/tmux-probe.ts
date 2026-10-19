// Tmux availability probe.
//
// Runs `<candidate> -V` across a fixed list of typical install locations and
// returns the first success. Used at startup and on `activate` (throttled) to
// drive the "同步 tmux 到工作区" tray menu item's `enabled` state.
//
// This is a READ-ONLY probe — it never spawns a session or attaches to one.

import { execFile } from 'child_process';

const CANDIDATE_PATHS = [
  'tmux',
  '/opt/homebrew/bin/tmux',
  '/usr/local/bin/tmux',
  '/usr/bin/tmux',
];

export interface TmuxProbeResult {
  available: boolean;
  path: string | null;
  version: string | null;
}

const UNAVAILABLE: TmuxProbeResult = {
  available: false,
  path: null,
  version: null,
};

function probeOne(bin: string): Promise<TmuxProbeResult | null> {
  return new Promise((resolve) => {
    const env = { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' };
    execFile(bin, ['-V'], { timeout: 3000, env }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const version = (stdout || '').trim() || null;
      resolve({ available: true, path: bin, version });
    });
  });
}

export async function probeTmux(): Promise<TmuxProbeResult> {
  for (const bin of CANDIDATE_PATHS) {
    const result = await probeOne(bin);
    if (result) return result;
  }
  return UNAVAILABLE;
}
