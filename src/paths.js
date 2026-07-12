/**
 * TokenVault — Shared data directory and runtime config
 *
 * All persistence lives under DATA_DIR. Override with TOKENVAULT_DATA_DIR
 * (used by the test suite to stay hermetic).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export const DATA_DIR = process.env.TOKENVAULT_DATA_DIR
  || path.join(os.homedir(), '.hermes', 'tokenvault');

export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

/**
 * Read the on/off toggle written by `tokenvault on|off`.
 * Read fresh on every call so the CLI toggle takes effect without a restart.
 */
export function isEnabled() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).enabled !== false;
  } catch {
    return true;
  }
}

export default { DATA_DIR, CONFIG_FILE, isEnabled };
