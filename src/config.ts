import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Try to load .env from project root (works for local dev / cloned repo).
// When run via npx, this file won't exist — that's fine, env vars come
// from the MCP config's "env" block instead.
try {
  const envPath = path.join(projectRoot, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
} catch {
  // Silently continue — env vars are already in process.env from MCP config
}

/**
 * Resolve a stable directory for runtime data (session.json, etc.).
 *
 * Priority:
 * 1. AULA_DATA_DIR env var (explicit override)
 * 2. <projectRoot>/data (when running from a cloned repo)
 * 3. ~/.aula-mcp/ (when running via npx — no stable project root)
 */
function resolveDataDir(): string {
  if (process.env.AULA_DATA_DIR) {
    return process.env.AULA_DATA_DIR;
  }

  // If running from a cloned repo, use the local data/ directory
  const localData = path.join(projectRoot, 'data');
  if (fs.existsSync(localData)) {
    return localData;
  }

  // Fallback: ~/.aula-mcp/
  const homeData = path.join(os.homedir(), '.aula-mcp');
  fs.mkdirSync(homeData, { recursive: true });
  return homeData;
}

export const config = {
  projectRoot,
  dataDir: resolveDataDir(),

  browser: {
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || '',
  },

  aula: {
    childName: process.env.AULA_CHILD_NAME || '',
    institutionName: process.env.AULA_INSTITUTION_NAME || '',
    apiUrl: process.env.AULA_API_URL || 'https://www.aula.dk/api/',
  },

  pingIntervalMinutes: parseInt(process.env.PING_INTERVAL_MINUTES || '15', 10),
};
