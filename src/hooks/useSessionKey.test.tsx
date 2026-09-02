import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import {
  useMintSessionKeyMutation, useActivateSessionKeyMutation, useRevokeSessionKeyMutation,
} from './useSessionKey';

beforeEach(() => queryClient.clear());

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useMintSessionKeyMutation', () => {
  it('POSTs /session-key/init with validUntil and dailyUsdCap', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionKeyAddress: '0xSK', enableTypedData: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMintSessionKeyMutation(), { wrapper });
    const data = await result.current.mutateAsync({ validUntil: 1234, dailyUsdCap: 100 });
    expect(data).toEqual({ sessionKeyAddress: '0xSK', enableTypedData: {} });
    expect(fetchMock).toHaveBeenCalledWith(
      '/session-key/init',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ validUntil: 1234, dailyUsdCap: 100 }),
      }),
    );
  });
});

describe('useActivateSessionKeyMutation', () => {
  it('POSTs /session-key/activate with the signature', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useActivateSessionKeyMutation(), { wrapper });
    await result.current.mutateAsync({ signature: '0xsig' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/session-key/activate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ signature: '0xsig' }) }),
    );
  });
});

describe('useRevokeSessionKeyMutation', () => {
  it('POSTs /session-key/revoke', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRevokeSessionKeyMutation(), { wrapper });
    await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledWith('/session-key/revoke', expect.objectContaining({ method: 'POST' }));
  });
});
