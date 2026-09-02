import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest, useFakeWsClient } from './testUtils';
import {
  useCredentialsStatusQuery, useCredentialsStatusAllQuery, useSaveCredentialsMutation,
  useTestCredentialsMutation, useClearCredentialsMutation,
} from './useCredentials';

vi.mock('../state/WsProvider', () => ({ useWsClient: () => useFakeWsClient() }));

beforeEach(() => queryClient.clear());

describe('useCredentialsStatusQuery', () => {
  it('calls credentialStatus over the WS client', async () => {
    const request = vi.fn().mockResolvedValue({ mainnet: { hasWalletKey: true } });
    const { result } = renderHook(() => useCredentialsStatusQuery(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <WsContextForTest request={request}>{children}</WsContextForTest>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.data).toEqual({ mainnet: { hasWalletKey: true } }));
    expect(request).toHaveBeenCalledWith('credentialStatus', {});
  });
});

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
