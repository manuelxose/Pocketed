import { entryPoint07Address } from "viem/account-abstraction";
import { config } from "./config.js";

// Task 6's buildUserOp (src/userOp.ts) builds a v0.7-shaped UserOperation
// using viem's entryPoint07Address (EntryPoint v0.7, canonical address
// 0x0000000071727De22E5E9d8BAf0edAc6f37da032). This module submits/queries
// that same UserOp, so it must target the same EntryPoint version — using
// the well-known v0.6 EntryPoint address here (0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789,
// which appeared in an earlier draft of this task's brief) would send a v0.7
// UserOp to the wrong contract. Importing the constant directly from viem
// (the same source userOp.ts uses) instead of hardcoding a second literal
// makes it structurally impossible for the two files to drift apart.
const ENTRY_POINT_ADDRESS = entryPoint07Address;

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(config.bundlerRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) {
    throw new Error(`bundler ${method} failed: ${body.error.message}`);
  }
  return body.result;
}

export async function submitUserOp(signedUserOp: object): Promise<{ userOpHash: string }> {
  const result = await rpcCall("eth_sendUserOperation", [signedUserOp, ENTRY_POINT_ADDRESS]);
  return { userOpHash: result as string };
}

export async function getUserOpStatus(
  userOpHash: string
): Promise<{ status: "pending" | "included" | "failed"; receipt?: object }> {
  const result = await rpcCall("eth_getUserOperationReceipt", [userOpHash]);
  if (!result) {
    return { status: "pending" };
  }
  const receipt = result as { success: boolean; receipt: object };
  return { status: receipt.success ? "included" : "failed", receipt: receipt.receipt };
}
