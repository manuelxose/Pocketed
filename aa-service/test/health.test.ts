import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

process.env.POLYGON_RPC_URL ??= "http://localhost:0";
process.env.BUNDLER_RPC_URL ??= "http://localhost:0";
process.env.PAYMASTER_PRIVATE_KEY ??= "0x" + "11".repeat(32);
process.env.PAYMASTER_DAILY_GAS_CAP_WEI ??= "1000000000000000000";

let createApp: typeof import("../src/app.js").createApp;
let app: import("express").Express;

beforeAll(async () => {
  ({ createApp } = await import("../src/app.js"));
  app = createApp();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
