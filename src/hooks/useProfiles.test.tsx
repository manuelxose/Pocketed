import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../lib/queryClient';
import {
  useProfilesQuery,
  useSaveProfileMutation,
  useApplyProfileMutation,
  useRenameProfileMutation,
  useDeleteProfileMutation,
  useDuplicateProfileMutation,
  useExportProfileMutation,
  useImportProfileMutation,
} from './useProfiles';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => queryClient.clear());

describe('useProfilesQuery', () => {
  it('fetches /profiles', async () => {
    const profiles = [{ id: 'p1', name: 'Profile 1' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => profiles }));
    const { result } = renderHook(() => useProfilesQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(profiles));
  });
});

describe('useSaveProfileMutation', () => {
  it('POSTs /profiles', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'p1', name: 'Profile 1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSaveProfileMutation(), { wrapper });
    await result.current.mutateAsync({ name: 'Profile 1', scope: 'main' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/profiles',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Profile 1', scope: 'main' }) }),
    );
  });
});

describe('useApplyProfileMutation', () => {
  it('POSTs /profiles/{id}/apply', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enableTrading: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useApplyProfileMutation(), { wrapper });
    await result.current.mutateAsync('p1');
    expect(fetchMock).toHaveBeenCalledWith('/profiles/p1/apply', expect.objectContaining({ method: 'POST' }));
  });
});

describe('useRenameProfileMutation', () => {
  it('PATCHes /profiles/{id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'p1', name: 'New' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRenameProfileMutation(), { wrapper });
    await result.current.mutateAsync({ id: 'p1', name: 'New' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/profiles/p1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'New' }) }),
    );
  });
});

describe('useDeleteProfileMutation', () => {
  it('DELETEs /profiles/{id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useDeleteProfileMutation(), { wrapper });
    await result.current.mutateAsync('p1');
    expect(fetchMock).toHaveBeenCalledWith('/profiles/p1', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('useDuplicateProfileMutation', () => {
  it('POSTs /profiles/{id}/duplicate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'p2', name: 'Profile 1 copy' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useDuplicateProfileMutation(), { wrapper });
    await result.current.mutateAsync('p1');
    expect(fetchMock).toHaveBeenCalledWith('/profiles/p1/duplicate', expect.objectContaining({ method: 'POST' }));
  });
});

describe('useExportProfileMutation', () => {
  it('GETs /profiles/{id}/export', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ json: '{}' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useExportProfileMutation(), { wrapper });
    const data = await result.current.mutateAsync('p1');
    expect(fetchMock).toHaveBeenCalledWith('/profiles/p1/export', expect.anything());
    expect(data).toEqual({ json: '{}' });
  });
});

describe('useImportProfileMutation', () => {
  it('POSTs /profiles/import', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'p3', name: 'Imported' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useImportProfileMutation(), { wrapper });
    await result.current.mutateAsync('{"name":"Imported"}');
    expect(fetchMock).toHaveBeenCalledWith(
      '/profiles/import',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ json: '{"name":"Imported"}' }) }),
    );
  });
});
