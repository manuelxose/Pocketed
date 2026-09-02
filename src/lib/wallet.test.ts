import { describe, expect, it, vi, beforeEach } from 'vitest';
import { connectWallet, signSiwe } from './wallet';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('connectWallet', () => {
  it('throws when window.ethereum is missing', async () => {
    vi.stubGlobal('ethereum', undefined);
    await expect(connectWallet()).rejects.toThrow(/ethereum/i);
  });

  it('returns the first requested account', async () => {
    const request = vi.fn().mockResolvedValue(['0xAAA']);
    vi.stubGlobal('ethereum', { request, selectedAddress: '0xAAA' });
    await expect(connectWallet()).resolves.toBe('0xAAA');
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });
});

describe('signSiwe', () => {
  it('builds a SIWE message and signs it via personal_sign', async () => {
    const request = vi.fn().mockResolvedValue('0xsig');
    vi.stubGlobal('ethereum', { request, selectedAddress: '0xAAA' });
    const { message, signature } = await signSiwe('nonce123', '0xAAA');
    expect(message).toContain('0xAAA');
    expect(message).toContain('nonce123');
    expect(signature).toBe('0xsig');
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: [message, '0xAAA'],
    });
  });
});
