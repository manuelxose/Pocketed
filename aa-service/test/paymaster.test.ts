import { describe, it, expect, beforeEach } from "vitest";

process.env.POLYGON_RPC_URL ??= "http://localhost:0";
process.env.BUNDLER_RPC_URL ??= "http://localhost:0";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";

const { DailyGasCap } = await import("../src/paymaster.js");

describe("DailyGasCap", () => {
  let cap: DailyGasCap;

  beforeEach(() => {
    cap = new DailyGasCap(1000n);
  });

  it("allows spend under the cap", () => {
    expect(cap.tryReserve("0xUser1", 400n)).toBe(true);
  });

  it("rejects spend that would exceed the cap", () => {
    cap.tryReserve("0xUser1", 700n);
    expect(cap.tryReserve("0xUser2", 400n)).toBe(false);
  });

  it("release lowers reserved-but-unused gas back into the pool", () => {
    cap.tryReserve("0xUser1", 700n);
    cap.release("0xUser1", 200n); // only 200 actually spent, not the reserved 700
    expect(cap.tryReserve("0xUser2", 750n)).toBe(true);
  });

  it("tracks spend per calendar day, independent of sender", () => {
    cap.tryReserve("0xUser1", 600n);
    expect(cap.tryReserve("0xUser1", 500n)).toBe(false);
  });
});
