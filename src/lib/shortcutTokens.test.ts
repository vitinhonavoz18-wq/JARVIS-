import { describe, it, expect } from 'vitest';
import { generateToken, sha256Hex } from './shortcutTokens.ts';

describe('chaves de atalho', () => {
  it('gera chaves únicas no formato aceito pelo servidor', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^jfv_[A-Za-z0-9_-]{30,80}$/);
  });
  it('hash SHA-256 em hexadecimal (formato exigido pelo banco)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
