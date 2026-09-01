import { createApp } from "./app.js";
import { config } from "./config.js";
import { checkBundlerHealth } from "./bundlerHealth.js";

const app = createApp();

checkBundlerHealth(config.bundlerRpcUrl)
  .then(({ chainId }) => {
    if (chainId !== config.chainId) {
      console.warn(
        `bundler reports chainId=${chainId}, aa-service configured for ${config.chainId}`
      );
    }
    app.listen(config.port, () => {
      console.log(`aa-service listening on :${config.port}`);
    });
  })
  .catch((e) => {
    console.error("bundler unreachable at startup:", e);
    process.exit(1);
  });
