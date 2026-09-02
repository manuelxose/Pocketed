import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ScriptApiDocs, ScriptAudit, ScriptBacktest, ScriptShadowOrder, ScriptValidation, UserScript,
} from '@shared/types';
import { useWsClient } from '../state/WsProvider';

// Merge one script into the ['scriptsList'] cache (insert or update by id) —
// avoids an invalidate+refetch round trip for a resource the RPC already
// hands back in full, same as useConfig's onSuccess: setQueryData pattern.
function upsertScriptInList(qc: QueryClient, script: UserScript) {
  qc.setQueryData(['scriptsList'], (old: { scripts: UserScript[] } | undefined) => {
    if (!old) return { scripts: [script] };
    const idx = old.scripts.findIndex((s) => s.id === script.id);
    if (idx === -1) return { scripts: [...old.scripts, script] };
    const next = old.scripts.slice();
    next[idx] = script;
    return { scripts: next };
  });
}

function removeScriptFromList(qc: QueryClient, id: string) {
  qc.setQueryData(['scriptsList'], (old: { scripts: UserScript[] } | undefined) =>
    (old ? { scripts: old.scripts.filter((s) => s.id !== id) } : old));
}

export function useScriptsListQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['scriptsList'],
    queryFn: () => client.request<{ scripts: UserScript[] }>('scriptsList', {}),
  });
}

export function useSaveScriptMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: { id?: string; name?: string; description?: string; code: string; notes?: string }) =>
      client.request<{
        script: UserScript; errors: string[]; warnings: string[];
        audit: ScriptAudit; disarmed?: boolean;
      }>('scriptSave', s as Record<string, unknown>),
    onSuccess: (data) => upsertScriptInList(qc, data.script),
  });
}

export function useDeleteScriptMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.request<{ ok: boolean }>('scriptDelete', { id }),
    onSuccess: (_data, id) => removeScriptFromList(qc, id),
  });
}

export function useSetScriptEnabledMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) =>
      client.request<{ script: UserScript }>('scriptSetEnabled', args),
    onSuccess: (data) => upsertScriptInList(qc, data.script),
  });
}

export function useSetScriptAssetsMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; assets: string[] | null }) =>
      client.request<{ script: UserScript }>('scriptSetAssets', args as Record<string, unknown>),
    onSuccess: (data) => upsertScriptInList(qc, data.script),
  });
}

export function useSetScriptDryRunMutation() {
  const client = useWsClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; dryRun: boolean }) =>
      client.request<{ script: UserScript }>('scriptSetDryRun', args),
    onSuccess: (data) => upsertScriptInList(qc, data.script),
  });
}

export function useScriptShadowOrdersQuery(
  id: string | null, limit?: number, opts?: { refetchInterval?: number | false },
) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['scriptShadowOrders', id, limit ?? null],
    queryFn: () => client.request<{ orders: ScriptShadowOrder[] }>('scriptShadowOrders', { id, limit }),
    enabled: !!id,
    refetchInterval: opts?.refetchInterval ?? false,
  });
}

export function useValidateScriptMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (code: string) => client.request<ScriptValidation>('scriptValidate', { code }),
  });
}

export function useScriptBacktestMutation() {
  const client = useWsClient();
  return useMutation({
    mutationFn: (args: {
      id?: string; code?: string; sinceDays?: number; assets?: string[] | null;
      config?: Record<string, unknown>;
    }) => client.request<ScriptBacktest | null>('scriptBacktest', args as Record<string, unknown>),
  });
}

export function useScriptContextPackQuery(enabled = true) {
  const client = useWsClient();
  return useQuery({
    queryKey: ['scriptContextPack'],
    queryFn: () => client.request<{ text: string }>('scriptContextPack', {}),
    enabled,
  });
}

export function useScriptApiDocsQuery() {
  const client = useWsClient();
  return useQuery({
    queryKey: ['scriptApiDocs'],
    queryFn: () => client.request<ScriptApiDocs>('scriptApiDocs', {}),
  });
}

// Read-only cache subscription: populated purely by the `script:log` push
// event routed into ['scriptsLog', id] by WsProvider. Never fetched.
export function useScriptLogsQuery(id: string | null) {
  return useQuery({
    queryKey: ['scriptsLog', id],
    queryFn: (): Promise<string[] | undefined> => Promise.resolve(undefined),
    enabled: false,
  });
}

// `scripts.exportFile`/`scripts.importFile` were Electron file-dialog calls
// with no RPC backing (dialog.showSaveDialog/showOpenDialog under the hood).
// In the browser these become a plain <a download> Blob URL and an
// <input type="file"> respectively — client-side only, no hook needed.
export function downloadScriptFile(filename: string, code: string): void {
  const blob = new Blob([code], { type: 'text/x-python' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readScriptFile(): Promise<{ name: string; code: string }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('no file selected'));
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, code: String(reader.result) });
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    };
    input.click();
  });
}
