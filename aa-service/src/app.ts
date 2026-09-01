import express from "express";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/account/:owner", async (req, res) => {
    const owner = req.params.owner as `0x${string}`;
    try {
      const { computeAccountAddress } = await import("./kernelAccount.js");
      const address = await computeAccountAddress(owner);
      res.json({ address });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/userop/build", async (req, res) => {
    const { owner, calls } = req.body as {
      owner: `0x${string}`;
      calls: { to: `0x${string}`; value: string; data: `0x${string}` }[];
    };
    try {
      const { buildUserOp } = await import("./userOp.js");
      const parsedCalls = calls.map((c) => ({ ...c, value: BigInt(c.value) }));
      const { userOp, userOpHash } = await buildUserOp(owner, parsedCalls);
      // userOp's gas/nonce fields are bigint, which JSON.stringify (and thus
      // express's res.json) cannot serialize on its own — stringify them
      // explicitly here.
      res
        .type("application/json")
        .send(JSON.stringify({ userOp, userOpHash }, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: message });
    }
  });

  return app;
}
