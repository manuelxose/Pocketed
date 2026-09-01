import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

process.env.POLYGON_RPC_URL ??= "https://rpc-amoy.polygon.technology";
process.env.BUNDLER_RPC_URL ??= "http://localhost:0";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";
process.env.CHAIN_ID ??= "80002";

let app: import("express").Express;
let createApp: typeof import("../src/app.js").createApp;

beforeAll(async () => {
  ({ createApp } = await import("../src/app.js"));
  app = createApp();
  // Warm the route's lazy `await import("./userOp.js")` here, outside any
  // single test's clock. userOp.js pulls in @zerodev/sdk + viem, which is
  // slow to load the first time — under full-suite load that first-request
  // import was blowing past vitest's default 5s per-test timeout even
  // though the route itself is fast once its dependencies are cached.
  await import("../src/userOp.js");
});

const OWNER = "0x4444444444444444444444444444444444444444" as const;

describe("POST /userop/build", () => {
  it("returns 200 with the userOp's bigint gas/nonce fields serialized as 0x-hex strings", async () => {
    // Regression test for a bug found during manual verification: plain
    // `res.json({ userOp, userOpHash })` throws "Do not know how to
    // serialize a BigInt" (express/JSON.stringify can't handle bigint),
    // which the route's own catch block turns into a 400. This test only
    // passes if the route actually serializes those fields (currently via
    // app.ts's custom JSON.stringify replacer) — reverting that back to a
    // plain res.json call would fail this test with a 400, not a silent pass.
    const res = await request(app)
      .post("/userop/build")
      .send({ owner: OWNER, calls: [{ to: OWNER, value: "0", data: "0x" }] });

    expect(res.status).toBe(200);
    expect(res.body.userOpHash).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(res.body.userOp).toBeTruthy();
    expect(res.body.userOp.sender).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // bigint fields must arrive as 0x-prefixed hex JSON strings — the format
    // ERC-4337's eth_sendUserOperation (and viem's own
    // formatUserOperationRequest) expect — not decimal strings, not raw
    // bigints (which JSON can't represent), and not silently dropped/coerced
    // to number.
    for (const field of [
      "nonce",
      "callGasLimit",
      "verificationGasLimit",
      "preVerificationGas",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
    ] as const) {
      expect(typeof res.body.userOp[field]).toBe("string");
      expect(res.body.userOp[field]).toMatch(/^0x[0-9a-f]+$/i);
    }
  });
});
