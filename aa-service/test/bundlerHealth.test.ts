import { describe, it, expect, vi, afterEach } from "vitest";
import { checkBundlerHealth } from "../src/bundlerHealth.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkBundlerHealth", () => {
  it("returns the chain id the bundler reports", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x13882" }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const result = await checkBundlerHealth("http://localhost:4337");

    expect(result.chainId).toBe(0x13882);
  });

  it("throws when the bundler is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    await expect(checkBundlerHealth("http://localhost:4337")).rejects.toThrow();
  });
});
