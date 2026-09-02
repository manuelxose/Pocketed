import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { useSessionQuery, useSwitchWalletMutation } from './useAccounts';

beforeEach(() => queryClient.clear());

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSessionQuery', () => {
  it('fetches /auth/session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wallets: ['0xAAA'], active: '0xAAA' }) }),
    );
    const { result } = renderHook(() => useSessionQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ wallets: ['0xAAA'], active: '0xAAA' }));
  });
});

describe('useSwitchWalletMutation', () => {
  it('POSTs /auth/switch with the address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ address: '0xBBB' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSwitchWalletMutation(), { wrapper });
    await result.current.mutateAsync('0xBBB');
    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/switch',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ address: '0xBBB' }) }),
    );
  });
});
