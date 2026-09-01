function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set — refusing to start aa-service without it`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4001),
  polygonRpcUrl: requireEnv("POLYGON_RPC_URL"),
  bundlerRpcUrl: requireEnv("BUNDLER_RPC_URL"),
  chainId: Number(process.env.CHAIN_ID ?? 137),
  paymasterPrivateKey: requireEnv("PAYMASTER_PRIVATE_KEY"),
  paymasterDailyGasCapWei: BigInt(process.env.PAYMASTER_DAILY_GAS_CAP_WEI ?? "0"),
};
