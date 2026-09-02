export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { credentials: 'include', ...init });
  if (!resp.ok) throw new Error(`${url} failed: ${resp.status}`);
  return resp.json();
}
