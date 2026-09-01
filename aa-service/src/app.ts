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

  return app;
}
