#!/usr/bin/env node

// ── Redirect console to stderr ───────────────────────────────────────
// MCP uses stdio (stdin/stdout) for JSON-RPC transport. Any stray
// console.log from dependencies (e.g. loglevel in AulaAPIClient) would
// corrupt the message stream. Redirect everything to stderr so library
// logging is harmless.
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.warn = (...args: unknown[]) => console.error(...args);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AulaAPIClient, AulaClientConfig } from '@ilenhart/aula-apiclient-ts';

import { config } from './config.js';
import { SessionManager } from './session/sessionManager.js';
import type { QRCaptureSession } from './browser/qrCapture.js';
import { registerAuthTools } from './tools/auth.js';
import { registerPostsTools } from './tools/posts.js';
import { registerMessagesTools } from './tools/messages.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerDailyTools } from './tools/daily.js';
import { registerGalleryTools } from './tools/gallery.js';
import { registerPeopleTools } from './tools/people.js';
import { registerMeebookTools } from './tools/meebook.js';

// ── Shared State ──────────────────────────────────────────────────────

const sessionManager = new SessionManager();
let aulaClient: AulaAPIClient | null = null;
let qrSession: QRCaptureSession | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

// ── Aula Client Initialization ────────────────────────────────────────

async function initAulaClient(): Promise<AulaAPIClient> {
  const aulaConfig = new AulaClientConfig();
  aulaConfig.sessionIdProvider = sessionManager;

  if (config.aula.apiUrl) {
    aulaConfig.aulaApiUrl = config.aula.apiUrl;
  }

  const client = new AulaAPIClient(aulaConfig);
  await client.Login();

  // Select child and institution by configured name
  if (config.aula.childName) {
    const child = client.GetMyChild(config.aula.childName);
    if (child) {
      client.SetMyCurrentChild(child.id);
    }
  }

  if (config.aula.institutionName) {
    const inst = client.GetMyInstitution(config.aula.institutionName);
    if (inst) {
      client.SetMyCurrentInstitution(inst.id);
    }
  }

  aulaClient = client;
  startKeepalive();
  return client;
}

// ── Session Keepalive ─────────────────────────────────────────────────

function startKeepalive() {
  if (keepaliveInterval) return; // Already running

  const intervalMs = config.pingIntervalMinutes * 60 * 1000;
  let consecutiveFailures = 0;

  keepaliveInterval = setInterval(async () => {
    if (!aulaClient) return;

    try {
      await aulaClient.PingAula();
      sessionManager.updateLastPinged();
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        sessionManager.markExpired();
        aulaClient = null;
        stopKeepalive();
        // Session will be re-established next time user calls aula_login
      }
    }
  }, intervalMs);
}

function stopKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

// ── MCP Server Setup ──────────────────────────────────────────────────

const server = new McpServer({
  name: 'aula',
  version: '1.0.0',
});

// Register all tool groups
registerAuthTools(server, {
  sessionManager,
  getQRSession: () => qrSession!,
  setQRSession: (session) => { qrSession = session; },
  getAulaClient: () => aulaClient,
  initAulaClient,
});

registerPostsTools(server, () => aulaClient);
registerMessagesTools(server, () => aulaClient);
registerCalendarTools(server, () => aulaClient);
registerDailyTools(server, () => aulaClient);
registerGalleryTools(server, () => aulaClient);
registerPeopleTools(server, () => aulaClient);
registerMeebookTools(server, () => aulaClient);

// ── Startup ───────────────────────────────────────────────────────────

async function main() {
  // Try to restore an existing session on startup
  if (sessionManager.isSessionAvailable()) {
    try {
      await initAulaClient();
      // Session restored successfully — keepalive started
    } catch {
      // Stored session is stale — that's fine, user will call aula_login
      sessionManager.markExpired();
    }
  }

  // Connect via stdio transport (how Claude Desktop communicates with MCP servers)
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  stopKeepalive();
  if (qrSession?.isOpen) await qrSession.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  stopKeepalive();
  if (qrSession?.isOpen) await qrSession.close();
  process.exit(0);
});

main().catch((err) => {
  console.error('Fatal error starting Aula MCP server:', err);
  process.exit(1);
});
