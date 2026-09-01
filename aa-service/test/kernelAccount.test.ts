import { describe, it, expect } from "vitest";
import { isAddress } from "viem";

process.env.POLYGON_RPC_URL ??= "https://rpc-amoy.polygon.technology";
process.env.BUNDLER_RPC_URL ??= "http://localhost:0";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";
process.env.CHAIN_ID ??= "80002";

const { computeAccountAddress } = await import("../src/kernelAccount.js");

const OWNER_A = "0x1111111111111111111111111111111111111111" as const;
const OWNER_B = "0x2222222222222222222222222222222222222222" as const;

describe("computeAccountAddress", () => {
  it("returns a valid address", async () => {
    const addr = await computeAccountAddress(OWNER_A);
    expect(isAddress(addr)).toBe(true);
  });

  it("is deterministic for the same owner", async () => {
    const a = await computeAccountAddress(OWNER_A);
    const b = await computeAccountAddress(OWNER_A);
    expect(a).toBe(b);
  });

  it("differs for different owners", async () => {
    const a = await computeAccountAddress(OWNER_A);
    const b = await computeAccountAddress(OWNER_B);
    expect(a).not.toBe(b);
  });
});
