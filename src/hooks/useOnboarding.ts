import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { credentials: 'include', ...init });
  if (!resp.ok) throw new Error(`${url} failed: ${resp.status}`);
  return resp.json();
}

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
