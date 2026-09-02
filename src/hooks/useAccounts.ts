import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../lib/api';
import { connectWallet, signSiwe } from '../lib/wallet';

export interface SessionData {
  wallets: string[];
  active: string;
}

export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => fetchJson<SessionData>('/auth/session'),
  });
}

export function useSwitchWalletMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (address: string) =>
      fetchJson('/auth/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
  });
}

export function useAddWalletMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const address = await connectWallet();
      const { nonce } = await fetchJson<{ nonce: string }>('/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const { message, signature } = await signSiwe(nonce, address);
      return fetchJson('/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
  });
}
