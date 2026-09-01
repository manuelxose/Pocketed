import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The @zerodev/sdk + viem import chain is expensive on first load; under
    // a full-suite run (not isolated) that cost can land inside a single
    // test's or beforeAll's default budget and time it out. Raised well
    // past observed worst-case (~10-12s full-suite runs) so the flake seen
    // in test/userOpRoute.test.ts and test/bundlerRoute.test.ts is closed,
    // not just reduced.
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
