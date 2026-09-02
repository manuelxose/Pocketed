import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest, useFakeWsClient } from './testUtils';
import {
  useCredentialsStatusAllQuery, useSaveCredentialsMutation,
  useTestCredentialsMutation, useClearCredentialsMutation,
} from './useCredentials';

vi.mock('../state/WsProvider', () => ({ useWsClient: () => useFakeWsClient() }));

beforeEach(() => queryClient.clear());

describe('useCredentialsStatusAllQuery', () => {
  it('calls credentialStatus over the WS client', async () => {
    const request = vi.fn().mockResolvedValue({ current: 'mainnet', mainnet: { hasWalletKey: false } });
    const { result } = renderHook(() => useCredentialsStatusAllQuery(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <WsContextForTest request={request}>{children}</WsContextForTest>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.data).toEqual({ current: 'mainnet', mainnet: { hasWalletKey: false } }));
    expect(request).toHaveBeenCalledWith('credentialStatus', {});
  });

  it('returns the real wrapped shape so callers can read data.mainnet.hasWalletKey (regression: Dashboard used to read the wrong field)', async () => {
    // The worker's credentialStatus RPC always returns the wrapped
    // CredentialsStatusAll shape ({current, mainnet: {...}}), never a flat
    // CredentialsState. Dashboard.tsx derives walletConnected from
    // `credentialsStatusAll?.mainnet?.hasWalletKey` — assert that path
    // resolves correctly from a realistic mock response.
    const request = vi.fn().mockResolvedValue({
      current: 'mainnet',
      mainnet: { hasWalletKey: true, hasApiCreds: true, address: '0xabc' },
    });
    const { result } = renderHook(() => useCredentialsStatusAllQuery(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <WsContextForTest request={request}>{children}</WsContextForTest>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const walletConnected = !!result.current.data?.mainnet?.hasWalletKey;
    expect(walletConnected).toBe(true);
  });
});

describe('useSaveCredentialsMutation', () => {
  it('surfaces the Phase-1-disabled rejection as a mutation error', async () => {
    const request = vi.fn().mockRejectedValue(new Error('setCredentials is not available yet'));
    const { result } = renderHook(() => useSaveCredentialsMutation(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <WsContextForTest request={request}>{children}</WsContextForTest>
        </QueryClientProvider>
      ),
    });
    await expect(
      result.current.mutateAsync({ env: 'mainnet', privateKey: 'x' } as any),
    ).rejects.toThrow('not available yet');
  });
});

describe('useTestCredentialsMutation', () => {
  it('calls testCredentials with the given env', async () => {
    const request = vi.fn().mockRejectedValue(new Error('testCredentials is not available yet'));
    const { result } = renderHook(() => useTestCredentialsMutation(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <WsContextForTest request={request}>{children}</WsContextForTest>
        </QueryClientProvider>
      ),
    });
    await expect(result.current.mutateAsync('mainnet')).rejects.toThrow('not available yet');
    expect(request).toHaveBeenCalledWith('testCredentials', { env: 'mainnet' });
  });
});

describe('useClearCredentialsMutation', () => {
  it('calls clearCredentials with the given env', async () => {
    const request = vi.fn().mockRejectedValue(new Error('clearCredentials is not available yet'));
    const { result } = renderHook(() => useClearCredentialsMutation(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <WsContextForTest request={request}>{children}</WsContextForTest>
        </QueryClientProvider>
      ),
    });
    await expect(result.current.mutateAsync('mainnet')).rejects.toThrow('not available yet');
    expect(request).toHaveBeenCalledWith('clearCredentials', { env: 'mainnet' });
  });
});
