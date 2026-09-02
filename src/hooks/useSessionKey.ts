import { useMutation } from '@tanstack/react-query';
import { fetchJson } from '../lib/api';

export interface SessionKeyInitInput {
  validUntil: number;
  dailyUsdCap: number;
}

export interface SessionKeyInitResult {
  sessionKeyAddress: string;
  enableTypedData: unknown;
  [key: string]: unknown;
}

export interface SessionKeyActivateInput {
  signature: string;
}

export function useMintSessionKeyMutation() {
  return useMutation({
    mutationFn: (input: SessionKeyInitInput) =>
      fetchJson<SessionKeyInitResult>('/session-key/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });
}

export function useActivateSessionKeyMutation() {
  return useMutation({
    mutationFn: (input: SessionKeyActivateInput) =>
      fetchJson('/session-key/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });
}

export function useRevokeSessionKeyMutation() {
  return useMutation({
    mutationFn: () => fetchJson('/session-key/revoke', { method: 'POST' }),
  });
}
