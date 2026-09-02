import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { useOnboardingQuery, useAcceptDisclaimerMutation, useResetOnboardingMutation } from './useOnboarding';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => queryClient.clear());

describe('useOnboardingQuery', () => {
  it('fetches /onboarding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ acceptedDisclaimer: false }) }),
    );
    const { result } = renderHook(() => useOnboardingQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ acceptedDisclaimer: false }));
  });
});

describe('useAcceptDisclaimerMutation', () => {
  it('PATCHes /onboarding with acceptedDisclaimer: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ acceptedDisclaimer: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAcceptDisclaimerMutation(), { wrapper });
    await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledWith(
      '/onboarding',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ acceptedDisclaimer: true }) }),
    );
  });
});

describe('useResetOnboardingMutation', () => {
  it('PATCHes /onboarding with acceptedDisclaimer: false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ acceptedDisclaimer: false }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useResetOnboardingMutation(), { wrapper });
    await result.current.mutateAsync();
    expect(fetchMock).toHaveBeenCalledWith(
      '/onboarding',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ acceptedDisclaimer: false }) }),
    );
  });
});
