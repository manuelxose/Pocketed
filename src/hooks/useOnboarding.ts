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

const RISK_ADDENDUM =
  '\n\n---\nRisk disclaimer: auto-trading involves risk; all P&L is your own. '
  + "There is no paper mode. Pocketed makes no guarantee of profitability. You are "
  + "solely responsible for compliance with Polymarket's terms of service and "
  + 'applicable law in your jurisdiction.';

/**
 * Contextual gate for actions that execute real trades (enabling an engine,
 * placing an order, etc). Browsing the app never requires this. On first use
 * it appends a risk disclaimer to the confirmation and records acceptance;
 * afterward it's a plain confirm. Returns true only if the user confirmed
 * (and, if needed, disclaimer acceptance was recorded successfully).
 */
export function useDisclaimerGate() {
  const { data: onboarding } = useOnboardingQuery();
  const acceptDisclaimer = useAcceptDisclaimerMutation();

  return async (message: string): Promise<boolean> => {
    const accepted = !!onboarding?.acceptedDisclaimer;
    const prompt = accepted ? message : `${message}${RISK_ADDENDUM}`;
    if (!window.confirm(prompt)) return false;
    if (!accepted) {
      try {
        await acceptDisclaimer.mutateAsync();
      } catch {
        return false;
      }
    }
    return true;
  };
}
