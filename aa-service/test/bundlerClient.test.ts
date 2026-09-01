import { describe, it, expect, vi, afterEach } from "vitest";

process.env.POLYGON_RPC_URL ??= "https://rpc-amoy.polygon.technology";
process.env.BUNDLER_RPC_URL ??= "http://localhost:4337";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";
process.env.CHAIN_ID ??= "80002";

const { submitUserOp, getUserOpStatus } = await import("../src/bundlerClient.js");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitUserOp", () => {
  it("returns the userOpHash the bundler assigns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xabc123" }), { status: 200 })
      )
    );

    const result = await submitUserOp({ sender: "0x1111111111111111111111111111111111111111" });

    expect(result.userOpHash).toBe("0xabc123");
  });

  it("submits against the EntryPoint v0.7 address, not v0.6", async () => {
    // Task 6's buildUserOp builds a v0.7-shaped UserOperation using viem's
    // entryPoint07Address. Submitting it against the v0.6 EntryPoint address
    // (0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789, from an earlier draft of
    // this task's brief) would target the wrong contract entirely. Assert
    // the actual RPC call params carry the v0.7 address.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xabc123" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await submitUserOp({ sender: "0x1111111111111111111111111111111111111111" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as { params: unknown[] };
    expect(body.params[1]).toBe("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
    expect(body.params[1]).not.toBe("0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789");
  });

  it("throws when the bundler rejects the UserOp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "AA21 didn't pay prefund" } }),
          { status: 200 }
        )
      )
    );

    await expect(submitUserOp({ sender: "0x1" })).rejects.toThrow(/AA21/);
  });
});

describe("getUserOpStatus", () => {
  it("reports pending when the bundler has no receipt yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }), { status: 200 })
      )
    );

    const result = await getUserOpStatus("0xabc123");

    expect(result.status).toBe("pending");
  });

  it("reports included with a receipt once the bundler has one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { success: true, receipt: { transactionHash: "0xdeadbeef" } } }),
          { status: 200 }
        )
      )
    );

    const result = await getUserOpStatus("0xabc123");

    expect(result.status).toBe("included");
    expect(result.receipt).toBeTruthy();
  });

  it("reports failed with a receipt when the bundler marks success: false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { success: false, receipt: { transactionHash: "0xdeadbeef" } } }),
          { status: 200 }
        )
      )
    );

    const result = await getUserOpStatus("0xabc123");

    expect(result.status).toBe("failed");
    expect(result.receipt).toBeTruthy();
  });
});
