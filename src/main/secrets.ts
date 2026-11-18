import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PROVIDER_IDS, type ProviderId } from '../core/shared/types';

/** The parts of Electron's safeStorage used here (backed by the macOS Keychain). */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * API keys, encrypted with a Keychain-held key and kept in the app's own
 * folder. Only the main process reads them; screens only learn which
 * providers have a key.
 */
export class KeyStore {
  private encrypted: Partial<Record<ProviderId, string>> = {};

  constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
  ) {
    try {
      if (existsSync(path)) this.encrypted = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      this.encrypted = {};
    }
  }

  set(provider: ProviderId, key: string): void {
    const value = key.trim();
    if (!value) {
      delete this.encrypted[provider];
    } else {
      if (!this.cipher.isEncryptionAvailable()) {
        throw new Error('The macOS Keychain is not available, so the key cannot be stored safely.');
      }
      this.encrypted[provider] = this.cipher.encryptString(value).toString('base64');
    }
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.encrypted), { mode: 0o600 });
  }

  get(provider: ProviderId): string {
    const value = this.encrypted[provider];
    if (!value) return '';
    try {
      return this.cipher.decryptString(Buffer.from(value, 'base64'));
    } catch {
      return '';
    }
  }

  all(): Record<ProviderId, string> {
    return Object.fromEntries(PROVIDER_IDS.map((id) => [id, this.get(id)])) as Record<ProviderId, string>;
  }

  status(): Record<ProviderId, boolean> {
    return Object.fromEntries(PROVIDER_IDS.map((id) => [id, Boolean(this.encrypted[id])])) as Record<ProviderId, boolean>;
  }
}
