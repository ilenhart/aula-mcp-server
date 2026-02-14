import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/sessionManager.js';
import type { QRCaptureSession } from '../browser/qrCapture.js';
import type { AulaAPIClient } from 'aula-apiclient-ts';

/**
 * Register authentication tools on the MCP server.
 *
 * Tools:
 * - aula_login: Start MitID auth flow, returns QR screenshot or "already authenticated"
 * - aula_check_auth: Poll for completed QR scan, returns status
 * - aula_session_status: Lightweight check if session is valid
 */
export function registerAuthTools(
  server: McpServer,
  deps: {
    sessionManager: SessionManager;
    getQRSession: () => QRCaptureSession;
    setQRSession: (session: QRCaptureSession) => void;
    getAulaClient: () => AulaAPIClient | null;
    initAulaClient: () => Promise<AulaAPIClient>;
  }
) {
  // ── aula_login ──────────────────────────────────────────────────────
  server.tool(
    'aula_login',
    'Start Aula authentication. If a valid session exists, confirms it. Otherwise opens a Chrome window with the MitID QR code and returns a screenshot for you to scan with your phone.',
    {},
    async () => {
      // First, try the existing session
      if (deps.sessionManager.isSessionAvailable()) {
        try {
          const client = await deps.initAulaClient();
          await client.PingAula();
          deps.sessionManager.updateLastPinged();
          return {
            content: [
              {
                type: 'text' as const,
                text: `Already authenticated. Session age: ${deps.sessionManager.getSessionAge() || 'unknown'}. You can now use any Aula data tools.`,
              },
            ],
          };
        } catch {
          deps.sessionManager.markExpired();
          // Fall through to QR flow
        }
      }

      // Need fresh authentication — launch browser and capture QR
      try {
        const { QRCaptureSession } = await import('../browser/qrCapture.js');
        const qrSession = new QRCaptureSession(deps.sessionManager);
        deps.setQRSession(qrSession);

        const screenshotBase64 = await qrSession.launchAndCaptureQR();

        return {
          content: [
            {
              type: 'text' as const,
              text: 'A Chrome window has opened with the Aula/MitID login page. The user needs to complete a few manual steps (click login, enter username, then scan the QR code with MitID). IMPORTANT: Immediately call aula_check_auth now WITHOUT waiting for the user to message you. The user will be busy in the browser. Keep calling aula_check_auth until it returns "authenticated" or "browser_closed".',
            },
            {
              type: 'image' as const,
              data: screenshotBase64,
              mimeType: 'image/png',
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to start login flow: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ── aula_check_auth ─────────────────────────────────────────────────
  server.tool(
    'aula_check_auth',
    'Check if the MitID QR code was scanned and authentication completed. Call this after aula_login. May return a refreshed QR screenshot if the previous one expired.',
    {},
    async () => {
      const qrSession = deps.getQRSession();
      if (!qrSession || !qrSession.isOpen) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No authentication flow in progress. Call aula_login first.',
            },
          ],
          isError: true,
        };
      }

      const result = await qrSession.pollForAuth(120_000);

      switch (result.status) {
        case 'authenticated':
          // Initialize the Aula client with the new session
          try {
            await deps.initAulaClient();
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Authentication successful! Session captured and stored. You can now use any Aula data tools.',
                },
              ],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Session captured but failed to initialize Aula client: ${message}. The session may still be valid — try calling aula_session_status.`,
                },
              ],
            };
          }

        case 'waiting':
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Still waiting for the user to complete authentication in the browser. IMPORTANT: Call aula_check_auth again immediately — do NOT wait for a user message. The user is busy with the MitID flow in the Chrome window.',
              },
            ],
          };

        case 'qr_refreshed':
          return {
            content: [
              {
                type: 'text' as const,
                text: 'The QR code was refreshed (the previous one expired). Here is the updated QR. IMPORTANT: Call aula_check_auth again immediately — do NOT wait for a user message.',
              },
              {
                type: 'image' as const,
                data: result.screenshot,
                mimeType: 'image/png',
              },
            ],
          };

        case 'browser_closed':
          return {
            content: [
              {
                type: 'text' as const,
                text: 'The authentication browser window was closed. Call aula_login to start a new authentication flow.',
              },
            ],
          };
      }
    }
  );

  // ── aula_session_status ─────────────────────────────────────────────
  server.tool(
    'aula_session_status',
    'Check if the current Aula session is valid without starting an auth flow.',
    {},
    async () => {
      const session = deps.sessionManager.getSession();

      if (!session || !session.phpsessid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ authenticated: false, reason: 'No session stored' }),
            },
          ],
        };
      }

      if (session.status !== 'active') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                authenticated: false,
                reason: `Session status: ${session.status}`,
                sessionAge: deps.sessionManager.getSessionAge(),
              }),
            },
          ],
        };
      }

      // Try a live ping
      const client = deps.getAulaClient();
      if (!client) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                authenticated: false,
                reason: 'Session file exists but Aula client not initialized. Call aula_login.',
                sessionAge: deps.sessionManager.getSessionAge(),
              }),
            },
          ],
        };
      }

      try {
        await client.PingAula();
        deps.sessionManager.updateLastPinged();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                authenticated: true,
                sessionAge: deps.sessionManager.getSessionAge(),
                lastPinged: new Date(session.lastPinged).toISOString(),
              }),
            },
          ],
        };
      } catch {
        deps.sessionManager.markExpired();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                authenticated: false,
                reason: 'Session expired (ping failed)',
                sessionAge: deps.sessionManager.getSessionAge(),
              }),
            },
          ],
        };
      }
    }
  );
}
