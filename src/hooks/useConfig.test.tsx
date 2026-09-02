import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import {
  useConfigQuery, usePatchConfigMutation, useReplaceConfigMutation, useResetConfigMutation,
} from './useConfig';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => queryClient.clear());

describe('useConfigQuery', () => {
  it('fetches /config', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTrading: false }) }));
    const { result } = renderHook(() => useConfigQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ enableTrading: false }));
  });
});

describe('usePatchConfigMutation', () => {
  it('PATCHes /config and invalidates the config query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTrading: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePatchConfigMutation(), { wrapper });
    await result.current.mutateAsync({ enableTrading: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/config',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enableTrading: true }) }),
    );
  });
});

describe('useReplaceConfigMutation', () => {
  it('PUTs /config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTrading: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useReplaceConfigMutation(), { wrapper });
    await result.current.mutateAsync({ enableTrading: true } as never);
    expect(fetchMock).toHaveBeenCalledWith(
      '/config',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enableTrading: true }) }),
    );
  });
});

describe('useResetConfigMutation', () => {
  it('POSTs /config/reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTrading: false }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useResetConfigMutation(), { wrapper });
    await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledWith('/config/reset', expect.objectContaining({ method: 'POST' }));
  });
});
