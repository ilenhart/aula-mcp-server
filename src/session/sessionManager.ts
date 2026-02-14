import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { ISessionIdProvider } from '@ilenhart/aula-apiclient-ts';

export interface StoredSession {
  phpsessid: string;
  lastPinged: number;
  createdAt: number;
  status: 'active' | 'expired' | 'reauth_pending';
}

/**
 * File-based session store that implements ISessionIdProvider from AulaAPIClient.
 * Persists PHPSESSID to data/session.json so it survives MCP server restarts.
 */
export class SessionManager implements ISessionIdProvider {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(config.dataDir, 'session.json');
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  // --- ISessionIdProvider interface ---

  getKnownAulaSessionId = async (): Promise<string> => {
    const session = this.read();
    return session?.phpsessid || '';
  };

  setKnownAulaSessionId = async (aulaSessionId: string): Promise<void> => {
    const current = this.read();
    const updated: StoredSession = {
      phpsessid: aulaSessionId,
      lastPinged: Date.now(),
      createdAt: current?.createdAt || Date.now(),
      status: 'active',
    };
    this.write(updated);
  };

  // --- Helpers ---

  getSession(): StoredSession | null {
    return this.read();
  }

  isSessionAvailable(): boolean {
    const session = this.read();
    return !!session?.phpsessid && session.status === 'active';
  }

  updateLastPinged(): void {
    const current = this.read();
    if (!current) return;
    current.lastPinged = Date.now();
    this.write(current);
  }

  markExpired(): void {
    const current = this.read();
    if (!current) return;
    current.status = 'expired';
    this.write(current);
  }

  clearSession(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  getSessionAge(): string | null {
    const session = this.read();
    if (!session) return null;
    const ageMs = Date.now() - session.createdAt;
    const hours = Math.floor(ageMs / (1000 * 60 * 60));
    const minutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  // --- Private file I/O (atomic writes) ---

  private read(): StoredSession | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const data = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(data) as StoredSession;
    } catch {
      return null;
    }
  }

  private write(session: StoredSession): void {
    const tmpPath = this.filePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }
}
