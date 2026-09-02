import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../lib/api';

export function useOnboardingQuery() {
  return useQuery({
    queryKey: ['onboarding'],
    queryFn: () => fetchJson<{ acceptedDisclaimer: boolean }>('/onboarding'),
  });
}

function usePatchOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { acceptedDisclaimer: boolean }) =>
      fetchJson('/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['onboarding'] }),
  });
}

export function useAcceptDisclaimerMutation() {
  const patch = usePatchOnboarding();
  return { ...patch, mutateAsync: () => patch.mutateAsync({ acceptedDisclaimer: true }) };
}

export function useResetOnboardingMutation() {
  const patch = usePatchOnboarding();
  return { ...patch, mutateAsync: () => patch.mutateAsync({ acceptedDisclaimer: false }) };
}
