import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Profile, ProfileScope, TraderConfig } from '@shared/types';
import { fetchJson } from '../lib/api';

export function useProfilesQuery() {
  return useQuery({ queryKey: ['profiles'], queryFn: () => fetchJson<Profile[]>('/profiles') });
}

function useInvalidateProfiles() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['profiles'] });
}

export function useSaveProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; scope: ProfileScope }) =>
      fetchJson<Profile>('/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useApplyProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson<TraderConfig>(`/profiles/${id}/apply`, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['config'], data),
  });
}

export function useRenameProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      fetchJson<Profile>(`/profiles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useDuplicateProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (id: string) => fetchJson<Profile>(`/profiles/${id}/duplicate`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useExportProfileMutation() {
  return useMutation({
    mutationFn: (id: string) => fetchJson<{ json: string }>(`/profiles/${id}/export`),
  });
}

export function useImportProfileMutation() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (json: string) =>
      fetchJson<Profile>('/profiles/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json }),
      }),
    onSuccess: invalidate,
  });
}
