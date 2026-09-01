import type { Address, Hex } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { getKernelAddressFromECDSA } from "@zerodev/ecdsa-validator";
import { constants } from "@zerodev/sdk";
import { config } from "./config.js";

// Importing config ensures this module (and anything that imports it) fails
// fast — same as the rest of aa-service — if required env vars are missing,
// even though the address computation below is a pure, local calculation
// that performs no RPC/network I/O of its own.
void config;

// Kernel v0.3.1 is the ECDSA-validator-compatible Kernel version for
// EntryPoint v0.7 (the current ERC-4337 entry point). Both the entry point
// and the Kernel version are fixed constants for this service; Task 5's
// UserOp builder should reuse these same values so addresses stay consistent.
const KERNEL_VERSION = "0.3.1" as const;
const ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const;

function getInitCodeHash(): Hex {
  const hash = constants.KernelVersionToAddressesMap[KERNEL_VERSION].initCodeHash;
  if (!hash) {
    throw new Error(`No initCodeHash known for Kernel version ${KERNEL_VERSION}`);
  }
  return hash;
}

const INIT_CODE_HASH = getInitCodeHash();

/**
 * Computes the counterfactual (pre-deployment) on-chain address of the
 * Kernel smart account that would be created for `owner` as its ECDSA
 * sudo-validator signer, at account index 0.
 *
 * This is a pure CREATE2 address derivation (factory address + salt derived
 * from the owner/validator/init data + implementation init-code hash) — it
 * needs no RPC call and never touches the private key material of `owner`.
 * `@zerodev/ecdsa-validator`'s `getKernelAddressFromECDSA` is ZeroDev's own
 * exported helper for exactly this computation; it replicates on the client
 * the same salt/identifier construction that
 * `createKernelAccount(client, { plugins: { sudo: <ecdsaValidator> } })`
 * would use on-chain, so the resulting address matches what that account
 * would deploy to.
 */
export async function computeAccountAddress(owner: Address): Promise<Address> {
  return getKernelAddressFromECDSA({
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    eoaAddress: owner,
    index: 0n,
    initCodeHash: INIT_CODE_HASH,
  });
}
