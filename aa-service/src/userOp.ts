import type { Address } from "viem";
import { entryPoint07Address, getUserOperationHash, type UserOperation } from "viem/account-abstraction";
import { encodeCallDataEpV07 } from "@zerodev/sdk";
import { config } from "./config.js";
import { computeAccountAddress } from "./kernelAccount.js";
import { dailyGasCap, paymasterSigner } from "./paymaster.js";

// Same fixed configuration as kernelAccount.ts (Task 2): EntryPoint v0.7,
// Kernel version 0.3.1, no hook plugin, no initConfig, account index 0n.
// This module never re-derives the account address on its own — `sender`
// below is computed by calling Task 2's `computeAccountAddress` directly, so
// it is *structurally impossible* for this module to target a different
// address than the one GET /account/:owner already told the user to fund.
// `encodeCallDataEpV07` (the EntryPoint-v0.7-specific call encoder) matches
// the EntryPoint version above; it is called with no `callType`/hooks
// arguments, so it defaults to a plain `call` execution with no hook data,
// matching Task 2's "no hook plugin" constraint.
const ENTRY_POINT_ADDRESS = entryPoint07Address;
const ENTRY_POINT_VERSION = "0.7" as const;

interface Call {
  to: Address;
  value: bigint;
  data: `0x${string}`;
}

// Kernel's ECDSA validator plugin (@zerodev/ecdsa-validator's
// toECDSAValidatorPlugin.ts) returns this exact fixed string as its
// `getStubSignature()` dummy value, used for gas-estimation before a real
// signature exists. Reused here verbatim as the placeholder `signature` on
// the *unsigned* UserOp this function returns — it is not a real signature.
// Verified against viem's `getUserOperationHash` implementation
// (viem/account-abstraction) that the signature field is never read when
// computing the hash (EIP-4337 hashes the op with signature excluded), so
// this placeholder has no effect on the returned `userOpHash`.
const STUB_SIGNATURE =
  "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c" as const;

// Rough gas estimate for the daily-cap check — refined against the
// bundler's own eth_estimateUserOperationGas once Task 7 wires real
// submission; this MVP reserves a fixed ceiling per call so the cap logic
// (Task 5) has something real to check against before a signature exists.
const ESTIMATED_GAS_PER_CALL_WEI = 200_000n * 30_000_000_000n; // 200k gas * 30 gwei

// Gas/nonce fields below are MVP placeholders, not fetched from the
// EntryPoint or bundler — this module makes no RPC calls of its own
// (mirroring kernelAccount.ts's local-only computation). Task 7, which owns
// real submission, must refresh the nonce and gas limits/fees via the
// bundler and add `factory`/`factoryData` (for an undeployed/counterfactual
// sender) before actually signing and submitting this UserOp on-chain; the
// `userOpHash` returned here will change once those fields are filled in
// with real values.
const NONCE = 0n; // placeholder: assumes this is the account's first UserOp
const CALL_GAS_LIMIT_PER_CALL = 200_000n;
const VERIFICATION_GAS_LIMIT = 150_000n;
const PRE_VERIFICATION_GAS = 50_000n;
const MAX_FEE_PER_GAS = 30_000_000_000n; // 30 gwei
const MAX_PRIORITY_FEE_PER_GAS = 30_000_000_000n;

export async function buildUserOp(
  owner: Address,
  calls: Call[]
): Promise<{ userOp: UserOperation<"0.7">; userOpHash: `0x${string}` }> {
  const estimate = ESTIMATED_GAS_PER_CALL_WEI * BigInt(calls.length);
  const cap = dailyGasCap();
  if (!cap.tryReserve(owner, estimate)) {
    throw new Error("aa-service daily gas cap exceeded — try again after the next UTC day rolls over");
  }

  try {
    const sender = await computeAccountAddress(owner);
    const callData = await encodeCallDataEpV07(calls);

    void paymasterSigner(); // reserved for Task 7, which will sign real paymaster fields

    const userOp: UserOperation<"0.7"> = {
      sender,
      nonce: NONCE,
      callData,
      callGasLimit: CALL_GAS_LIMIT_PER_CALL * BigInt(calls.length),
      verificationGasLimit: VERIFICATION_GAS_LIMIT,
      preVerificationGas: PRE_VERIFICATION_GAS,
      maxFeePerGas: MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
      signature: STUB_SIGNATURE,
    };

    const userOpHash = getUserOperationHash({
      chainId: config.chainId,
      entryPointAddress: ENTRY_POINT_ADDRESS,
      entryPointVersion: ENTRY_POINT_VERSION,
      userOperation: userOp,
    });

    return { userOp, userOpHash };
  } finally {
    // This endpoint only builds/quotes an *unsigned* UserOp — nothing has
    // been submitted or executed yet, and the caller may never submit it.
    // Holding daily-cap budget hostage for a quote that's merely previewed
    // would let a burst of /userop/build calls starve real submissions, so
    // give the reservation back immediately: this call only *validates*
    // there is room right now. Task 7 (the actual submit endpoint) is
    // responsible for reserving-and-holding real budget at execution time,
    // and for releasing only the unused portion once real gas usage is known.
    cap.release(owner, estimate);
  }
}
