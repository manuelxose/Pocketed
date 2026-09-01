import { createApp } from "./app.js";
import { config } from "./config.js";
import { checkBundlerHealth } from "./bundlerHealth.js";

const app = createApp();

// Bind to loopback only: aa-service holds PAYMASTER_PRIVATE_KEY and has no
// auth of its own — it must never be reachable from outside this host. The
// gateway (webserver/) is expected to run on the same host and talk to it
// over 127.0.0.1. See aa-service/README.md.
const HOST = "127.0.0.1";

checkBundlerHealth(config.bundlerRpcUrl)
  .then(({ chainId }) => {
    if (chainId !== config.chainId) {
      // A chain-id mismatch means a signed UserOp could be replayed on, or
      // rejected by, the wrong network — refuse to start rather than merely
      // warning, matching the "refuse to start without it" pattern used for
      // required config elsewhere in this codebase (see requireEnv() above
      // and webserver/main.py's SESSION_SECRET/AA_SERVICE_URL checks).
      throw new Error(
        `bundler reports chainId=${chainId}, aa-service configured for ${config.chainId} — refusing to start`
      );
    }
    app.listen(config.port, HOST, () => {
      console.log(`aa-service listening on ${HOST}:${config.port}`);
    });
  })
  .catch((e) => {
    console.error("aa-service failed to start:", e);
    process.exit(1);
  });
