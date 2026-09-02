import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { useStrategiesQuery, useApplyStrategyMutation } from './useStrategies';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => queryClient.clear());

describe('useStrategiesQuery', () => {
  it('fetches /strategies', async () => {
    const strategies = [{ id: 'aggressive', name: 'Aggressive' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => strategies }));
    const { result } = renderHook(() => useStrategiesQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(strategies));
  });
});

describe('useApplyStrategyMutation', () => {
  it('POSTs /strategies/{id}/apply', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTrading: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useApplyStrategyMutation(), { wrapper });
    await result.current.mutateAsync('aggressive');
    expect(fetchMock).toHaveBeenCalledWith('/strategies/aggressive/apply', expect.objectContaining({ method: 'POST' }));
  });
});
