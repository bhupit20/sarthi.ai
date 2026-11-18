import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KeyStore, type Cipher } from '../../src/main/secrets';

/** Stand-in for Electron's safeStorage (the Keychain on a Mac). */
const cipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
};

const file = () => join(mkdtempSync(join(tmpdir(), 'keys-')), 'keys.json');

describe('KeyStore', () => {
  it('saves keys encrypted, never as plain text', () => {
    const path = file();
    const store = new KeyStore(path, cipher);
    store.set('nvidia', 'nvapi-secret-123');
    expect(readFileSync(path, 'utf8')).not.toContain('nvapi-secret-123');
    expect(new KeyStore(path, cipher).get('nvidia')).toBe('nvapi-secret-123');
  });

  it('reports which providers have a key without revealing them', () => {
    const store = new KeyStore(file(), cipher);
    store.set('claude', 'sk-1');
    expect(store.status()).toEqual({ claude: true, openai: false, gemini: false, nvidia: false });
  });

  it('removes a key when it is set to empty, and trims spaces', () => {
    const store = new KeyStore(file(), cipher);
    store.set('gemini', '  key  ');
    expect(store.get('gemini')).toBe('key');
    store.set('gemini', '   ');
    expect(store.status().gemini).toBe(false);
  });

  it('gives all keys for an AI call', () => {
    const store = new KeyStore(file(), cipher);
    store.set('openai', 'o');
    expect(store.all()).toEqual({ claude: '', openai: 'o', gemini: '', nvidia: '' });
  });

  it('refuses to store keys when the Keychain is unavailable', () => {
    const store = new KeyStore(file(), { ...cipher, isEncryptionAvailable: () => false });
    expect(() => store.set('claude', 'x')).toThrow(/Keychain/);
  });

  it('starts empty when the file is missing or damaged', () => {
    expect(new KeyStore(join(tmpdir(), 'does-not-exist', 'k.json'), cipher).status().claude).toBe(false);
  });
});
