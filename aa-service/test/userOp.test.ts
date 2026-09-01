import { describe, it, expect } from "vitest";
import { isHex } from "viem";

process.env.POLYGON_RPC_URL ??= "https://rpc-amoy.polygon.technology";
process.env.BUNDLER_RPC_URL ??= "http://localhost:0";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";
process.env.CHAIN_ID ??= "80002";

const { buildUserOp } = await import("../src/userOp.js");

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const SELF_CALL = [{ to: OWNER, value: 0n, data: "0x" as const }];

describe("buildUserOp", () => {
  it("returns a UserOp and a hash to sign", async () => {
    const { userOp, userOpHash } = await buildUserOp(OWNER, SELF_CALL);

    expect(userOp).toBeTruthy();
    expect(isHex(userOpHash)).toBe(true);
  });

  it("rejects when the daily gas cap has no room", async () => {
    const { dailyGasCap } = await import("../src/paymaster.js");
    const cap = dailyGasCap();
    // Exhaust the cap directly rather than looping real UserOps — this
    // test only checks buildUserOp's error path, not gas estimation.
    cap.tryReserve(OWNER, 10n ** 18n);

    await expect(buildUserOp(OWNER, SELF_CALL)).rejects.toThrow(/gas cap/i);
  });
});
