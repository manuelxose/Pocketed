import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /userop/submit", () => {
  it("returns 200 with the userOpHash when the bundler accepts the UserOp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xabc123" }), { status: 200 })
      )
    );

    const res = await request(app)
      .post("/userop/submit")
      .send({ userOp: { sender: "0x1111111111111111111111111111111111111111" } });

    expect(res.status).toBe(200);
    expect(res.body.userOpHash).toBe("0xabc123");
  });

  it("returns 400 when the bundler rejects the UserOp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "AA21 didn't pay prefund" } }),
          { status: 200 }
        )
      )
    );

    const res = await request(app)
      .post("/userop/submit")
      .send({ userOp: { sender: "0x1" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/AA21/);
  });
});

describe("GET /userop/:hash/status", () => {
  it("returns 200 with status pending when the bundler has no receipt yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }), { status: 200 })
      )
    );

    const res = await request(app).get("/userop/0xabc123/status");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
  });

  it("returns 200 with status included and a receipt once the bundler has one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { success: true, receipt: { transactionHash: "0xdeadbeef" } },
          }),
          { status: 200 }
        )
      )
    );

    const res = await request(app).get("/userop/0xabc123/status");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("included");
    expect(res.body.receipt).toBeTruthy();
  });

  it("returns 502 when the bundler is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    const res = await request(app).get("/userop/0xabc123/status");

    expect(res.status).toBe(502);
  });
});
