export async function checkBundlerHealth(rpcUrl: string): Promise<{ chainId: number }> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (!res.ok) {
    throw new Error(`bundler health check failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) {
    throw new Error(`bundler health check failed: ${body.error.message}`);
  }
  if (!body.result) {
    throw new Error("bundler health check failed: no result in response");
  }
  return { chainId: Number.parseInt(body.result, 16) };
}
