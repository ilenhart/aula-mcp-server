import { config } from '../config.js';
import { SessionManager } from '../session/sessionManager.js';

const COOKIE_POLL_MS = 3_000;
const PAGE_REFRESH_MS = 4 * 60 * 1000; // Refresh login page every 4 min to keep QR fresh

/**
 * Manages a visible Chrome browser instance for MitID QR code authentication.
 *
 * Flow:
 * 1. launchAndCaptureQR() — opens Chrome, navigates to Aula, screenshots the QR code
 * 2. pollForAuth() — checks if the user scanned the QR and logged in
 * 3. refreshQR() — re-navigates to get a fresh QR if the old one expired
 * 4. close() — shuts down the browser instance
 */
export class QRCaptureSession {
  private browser: any = null;
  private page: any = null;
  private sessionManager: SessionManager;
  private lastPageRefresh: number = 0;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  get isOpen(): boolean {
    return this.browser !== null && this.page !== null;
  }

  /**
   * Launch a visible Chrome window, navigate to Aula login, and capture a screenshot
   * of the QR code area. Returns the screenshot as a base64 PNG string.
   */
  async launchAndCaptureQR(): Promise<string> {
    const puppeteer = await import('puppeteer-core');

    if (!config.browser.executablePath) {
      throw new Error(
        'BROWSER_EXECUTABLE_PATH not set. Please configure it in .env to point to your Chrome installation.'
      );
    }

    this.browser = await puppeteer.default.launch({
      headless: false,
      executablePath: config.browser.executablePath,
      args: ['--no-sandbox', '--start-maximized'],
      defaultViewport: { width: 1280, height: 900 },
    });

    this.page = await this.browser.newPage();
    await this.page.goto('https://www.aula.dk/', {
      waitUntil: 'networkidle2',
      timeout: 60_000,
    });
    this.lastPageRefresh = Date.now();

    // Give the MitID QR a moment to render
    await this.page.waitForTimeout(3000);

    return await this.takeScreenshot();
  }

  /**
   * Poll the browser to check if the user completed MitID authentication.
   * Waits up to `timeoutMs` milliseconds (default 30s — fits within MCP tool call timeouts).
   *
   * Returns:
   * - { status: 'authenticated', sessionId: string } if login detected
   * - { status: 'waiting' } if still waiting
   * - { status: 'qr_refreshed', screenshot: string } if QR was auto-refreshed (new image)
   * - { status: 'browser_closed' } if user closed the browser window
   */
  async pollForAuth(timeoutMs: number = 30_000): Promise<PollResult> {
    if (!this.page || !this.browser) {
      return { status: 'browser_closed' };
    }

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      // Check if page/browser was closed
      try {
        if (this.page.isClosed()) {
          this.browser = null;
          this.page = null;
          return { status: 'browser_closed' };
        }
      } catch {
        this.browser = null;
        this.page = null;
        return { status: 'browser_closed' };
      }

      // Check for PHPSESSID cookie + login redirect
      try {
        const cookies = await this.page.cookies('https://www.aula.dk');
        const phpCookie = cookies.find((c: { name: string }) => c.name === 'PHPSESSID');

        if (phpCookie?.value) {
          const url = this.page.url();
          const isLoggedIn =
            url.includes('/portal') || url.includes('#/') || !url.includes('login');

          if (isLoggedIn) {
            const sessionId = phpCookie.value;
            await this.sessionManager.setKnownAulaSessionId(sessionId);
            await this.close();
            return { status: 'authenticated', sessionId };
          }
        }
      } catch {
        // Page might be navigating — ignore and retry
      }

      // Auto-refresh the login page if QR is getting stale
      if (Date.now() - this.lastPageRefresh > PAGE_REFRESH_MS) {
        try {
          await this.page.reload({ waitUntil: 'networkidle2', timeout: 30_000 });
          this.lastPageRefresh = Date.now();
          await this.page.waitForTimeout(3000);
          const screenshot = await this.takeScreenshot();
          return { status: 'qr_refreshed', screenshot };
        } catch {
          // Non-critical — continue polling
        }
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, COOKIE_POLL_MS));
    }

    return { status: 'waiting' };
  }

  /**
   * Manually refresh the QR code and return a new screenshot.
   */
  async refreshQR(): Promise<string | null> {
    if (!this.page) return null;
    try {
      await this.page.reload({ waitUntil: 'networkidle2', timeout: 30_000 });
      this.lastPageRefresh = Date.now();
      await this.page.waitForTimeout(3000);
      return await this.takeScreenshot();
    } catch {
      return null;
    }
  }

  /**
   * Close the browser instance.
   */
  async close(): Promise<void> {
    try {
      if (this.browser) await this.browser.close();
    } catch { /* ignore close errors */ }
    this.browser = null;
    this.page = null;
  }

  private async takeScreenshot(): Promise<string> {
    const buffer = await this.page.screenshot({
      encoding: 'base64',
      type: 'png',
      fullPage: false,
    });
    return buffer as string;
  }
}

export type PollResult =
  | { status: 'authenticated'; sessionId: string }
  | { status: 'waiting' }
  | { status: 'qr_refreshed'; screenshot: string }
  | { status: 'browser_closed' };
