import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { WsContextForTest } from './testUtils';
import {
  useScriptsListQuery,
  useSaveScriptMutation,
  useDeleteScriptMutation,
  useSetScriptEnabledMutation,
  useSetScriptAssetsMutation,
  useSetScriptDryRunMutation,
  useScriptShadowOrdersQuery,
  useValidateScriptMutation,
  useScriptBacktestMutation,
  useScriptContextPackQuery,
  useScriptApiDocsQuery,
  downloadScriptFile,
} from './useScripts';

vi.mock('../state/WsProvider', async () => {
  const { useFakeWsClient } = await import('./testUtils');
  return { useWsClient: () => useFakeWsClient() };
});

beforeEach(() => queryClient.clear());

function wrap(request: (m: string, p?: unknown) => Promise<unknown>) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WsContextForTest request={request}>{children}</WsContextForTest>
    </QueryClientProvider>
  );
}

describe('useScriptsListQuery', () => {
  it('calls scriptsList', async () => {
    const request = vi.fn().mockResolvedValue({ scripts: [] });
    const { result } = renderHook(() => useScriptsListQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ scripts: [] }));
    expect(request).toHaveBeenCalledWith('scriptsList', {});
  });
});

describe('useSaveScriptMutation', () => {
  it('calls scriptSave with the script payload', async () => {
    const request = vi.fn().mockResolvedValue({ script: {}, errors: [], warnings: [], audit: {} });
    const { result } = renderHook(() => useSaveScriptMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ id: 's1', code: 'print(1)' });
    expect(request).toHaveBeenCalledWith('scriptSave', { id: 's1', code: 'print(1)' });
  });
});

describe('useDeleteScriptMutation', () => {
  it('calls scriptDelete with the id', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDeleteScriptMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync('s1');
    expect(request).toHaveBeenCalledWith('scriptDelete', { id: 's1' });
  });
});

describe('useSetScriptEnabledMutation', () => {
  it('calls scriptSetEnabled with id and enabled', async () => {
    const request = vi.fn().mockResolvedValue({ script: {} });
    const { result } = renderHook(() => useSetScriptEnabledMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ id: 's1', enabled: true });
    expect(request).toHaveBeenCalledWith('scriptSetEnabled', { id: 's1', enabled: true });
  });
});

describe('useSetScriptAssetsMutation', () => {
  it('calls scriptSetAssets with id and assets', async () => {
    const request = vi.fn().mockResolvedValue({ script: {} });
    const { result } = renderHook(() => useSetScriptAssetsMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ id: 's1', assets: ['BTC'] });
    expect(request).toHaveBeenCalledWith('scriptSetAssets', { id: 's1', assets: ['BTC'] });
  });
});

describe('useSetScriptDryRunMutation', () => {
  it('calls scriptSetDryRun with id and dryRun', async () => {
    const request = vi.fn().mockResolvedValue({ script: {} });
    const { result } = renderHook(() => useSetScriptDryRunMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ id: 's1', dryRun: false });
    expect(request).toHaveBeenCalledWith('scriptSetDryRun', { id: 's1', dryRun: false });
  });
});

describe('useScriptShadowOrdersQuery', () => {
  it('calls scriptShadowOrders with id and limit', async () => {
    const request = vi.fn().mockResolvedValue({ orders: [] });
    const { result } = renderHook(() => useScriptShadowOrdersQuery('s1', 200), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ orders: [] }));
    expect(request).toHaveBeenCalledWith('scriptShadowOrders', { id: 's1', limit: 200 });
  });

  it('does not call scriptShadowOrders when id is null', () => {
    const request = vi.fn().mockResolvedValue({ orders: [] });
    renderHook(() => useScriptShadowOrdersQuery(null), { wrapper: wrap(request) });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('useValidateScriptMutation', () => {
  it('calls scriptValidate with code', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, errors: [], warnings: [] });
    const { result } = renderHook(() => useValidateScriptMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync('print(1)');
    expect(request).toHaveBeenCalledWith('scriptValidate', { code: 'print(1)' });
  });
});

describe('useScriptBacktestMutation', () => {
  it('calls scriptBacktest with args', async () => {
    const request = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useScriptBacktestMutation(), { wrapper: wrap(request) });
    await result.current.mutateAsync({ id: 's1', sinceDays: 30 });
    expect(request).toHaveBeenCalledWith('scriptBacktest', { id: 's1', sinceDays: 30 });
  });
});

describe('useScriptContextPackQuery', () => {
  it('calls scriptContextPack', async () => {
    const request = vi.fn().mockResolvedValue({ text: 'pack' });
    const { result } = renderHook(() => useScriptContextPackQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ text: 'pack' }));
    expect(request).toHaveBeenCalledWith('scriptContextPack', {});
  });
});

describe('useScriptApiDocsQuery', () => {
  it('calls scriptApiDocs', async () => {
    const request = vi.fn().mockResolvedValue({ contract: 'x', fields: [] });
    const { result } = renderHook(() => useScriptApiDocsQuery(), { wrapper: wrap(request) });
    await waitFor(() => expect(result.current.data).toEqual({ contract: 'x', fields: [] }));
    expect(request).toHaveBeenCalledWith('scriptApiDocs', {});
  });
});

describe('downloadScriptFile', () => {
  it('creates and clicks a download link with the given filename and code', () => {
    const clickSpy = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      click: clickSpy,
      set href(v: string) {},
      set download(v: string) {},
    } as unknown as HTMLAnchorElement);
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });
    downloadScriptFile('my-script.py', 'print(1)');
    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(clickSpy).toHaveBeenCalled();
    createElementSpy.mockRestore();
  });
});
