import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CredentialsInput, CredentialsStatusAll } from '@shared/types';
import { useWsClient } from '../state/WsProvider';

export function useCredentialsStatusAllQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['credentialsStatusAll'],
    queryFn: () => client.request<CredentialsStatusAll>('credentialStatus', {}),
  });
}

export function useSaveCredentialsMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CredentialsInput) =>
      client.request('setCredentials', input as unknown as Record<string, unknown>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentialsStatus'] });
      qc.invalidateQueries({ queryKey: ['credentialsStatusAll'] });
    },
  });
}

export function useTestCredentialsMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (env?: string) => client.request('testCredentials', env ? { env } : {}),
  });
}

export function useClearCredentialsMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (env?: string) => client.request('clearCredentials', env ? { env } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentialsStatus'] });
      qc.invalidateQueries({ queryKey: ['credentialsStatusAll'] });
    },
  });
}
