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
  const message =
    `${window.location.host} wants you to sign in with your Ethereum account:\n${address}\n\n` +
    `Click to sign in and accept the Terms of Service.\n\n` +
    `URI: ${window.location.origin}\nVersion: 1\nChain ID: 80002\n` +
    `Nonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  const signature = (await eth.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;
  return { message, signature };
}
