export async function connectWallet(): Promise<string> {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) throw new Error('window.ethereum not found — install MetaMask or similar');
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts[0];
}

interface EthereumProvider {
  selectedAddress?: string;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export async function signSiwe(
  nonce: string,
  address: string,
): Promise<{ message: string; signature: string }> {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) throw new Error('window.ethereum not found');
  // Read the wallet's own connected chain rather than hardcoding one: the
  // gateway (webserver/auth.py's POCKETED_SIWE_CHAIN_IDS allowlist) is the
  // source of truth for which chains are actually accepted, and a mismatch
  // here just means auth.verify_siwe rejects it with a clear "chain_id not
  // accepted" error instead of the wallet silently signing for the wrong
  // network.
  const chainIdHex = (await eth.request({ method: 'eth_chainId' })) as string;
  const chainId = parseInt(chainIdHex, 16);
  const message =
    `${window.location.host} wants you to sign in with your Ethereum account:\n${address}\n\n` +
    `Click to sign in and accept the Terms of Service.\n\n` +
    `URI: ${window.location.origin}\nVersion: 1\nChain ID: ${chainId}\n` +
    `Nonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  const signature = (await eth.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;
  return { message, signature };
}

export async function signTypedData(address: string, typedData: unknown): Promise<string> {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) throw new Error('window.ethereum not found');
  return (await eth.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(typedData)],
  })) as string;
}
