// aa-service/scripts/gen-session-key-fixture.ts
//
// Dev-only script (not part of the running service). Generates a
// deterministic "golden" session-key signature using ZeroDev's real SDK,
// so Python (Task 4) has a byte-exact target to match instead of a
// hand-derived guess at Kernel's wrap + permission-validator encoding.
import { writeFileSync } from "node:fs";
import {
  concatHex,
  createPublicClient,
  http,
  serializeErc6492Signature,
  type Hex,
} from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { accountMetadata, createKernelAccount } from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  toSignatureCallerPolicy,
  toTimestampPolicy,
} from "@zerodev/permissions/policies";
import { entryPoint07Address } from "viem/account-abstraction";

// Fixed, deterministic inputs — never regenerate these unless the Kernel
// version or EntryPoint version changes (see Global Constraints).
const OWNER_PRIVATE_KEY: Hex =
  "0x1111111111111111111111111111111111111111111111111111111111111111".slice(0, 66) as Hex;
// Fixed and distinct from OWNER_PRIVATE_KEY (all-1s) so the two roles stay
// visually distinguishable in the fixture — the session key must be
// deterministic so re-running this script reproduces byte-identical output
// (Task 10's e2e check diffs the committed fixture against a fresh run).
const SESSION_KEY_PRIVATE_KEY: Hex =
  "0x2222222222222222222222222222222222222222222222222222222222222222".slice(0, 66) as Hex;
// Polymarket CTF Exchange v2 (python/polymarket_auth.py EXCHANGE_ADDRESS) —
// the only address allowed to call isValidSignature on this session key.
const CTF_EXCHANGE_V2 = "0xE111180000d2663C0091e4f400237545B87B996B" as const;
const VALID_UNTIL = 1893456000; // fixed far-future UTC timestamp, deterministic
// A fixed, arbitrary 32-byte "order digest" standing in for a real
// Polymarket Order struct hash — Task 4's cross-check only needs the
// signature scheme to match, not a real order.
const ORDER_DIGEST_MESSAGE = "0x" + "ab".repeat(32);

async function main() {
  const publicClient = createPublicClient({ chain: polygon, transport: http() });
  const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);
  const sessionKeyAccount = privateKeyToAccount(SESSION_KEY_PRIVATE_KEY);

  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerAccount,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    kernelVersion: "0.3.1",
  });

  const ecdsaSigner = await toECDSASigner({ signer: sessionKeyAccount });
  // toPermissionValidator has no top-level `validUntil` param in the
  // installed SDK version — expiry is enforced via a TimestampPolicy
  // alongside the SignatureCallerPolicy.
  const callerPolicy = toSignatureCallerPolicy({ allowedCallers: [CTF_EXCHANGE_V2] });
  const timestampPolicy = toTimestampPolicy({ validUntil: VALID_UNTIL });

  const permissionValidator = await toPermissionValidator(publicClient, {
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    kernelVersion: "0.3.1",
    signer: ecdsaSigner,
    policies: [callerPolicy, timestampPolicy],
  });

  const kernelAccount = await createKernelAccount(publicClient, {
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    kernelVersion: "0.3.1",
    plugins: { sudo: sudoValidator, regular: permissionValidator },
  });

  // NOTE: deliberately *not* `kernelAccount.signMessage({ message: { raw } })`.
  // That path runs viem's `hashMessage()` first, i.e. it EIP-191
  // personal-sign-prefixes the digest ("\x19Ethereum Signed Message:\n32" ||
  // digest) *before* Kernel's own EIP-712 wrap. The Polymarket CTF Exchange
  // calls `isValidSignature(orderHash, sig)` with the RAW order hash, and
  // Kernel's ERC1271 wraps that raw hash directly — no personal-sign layer.
  // So we reproduce exactly what `createKernelAccount`'s signMessage does
  // *after* the hashMessage step, feeding it the raw digest instead:
  // Kernel(bytes32 hash) EIP-712 wrap -> permission-validator signature ->
  // validation-id prefix -> ERC-6492 wrap while counterfactual.
  const accountAddress = await kernelAccount.getAddress();
  const { name, version, chainId } = await accountMetadata(
    publicClient,
    accountAddress,
    "0.3.1",
    polygon.id
  );

  const innerSignature = await kernelAccount.kernelPluginManager.signTypedData({
    message: { hash: ORDER_DIGEST_MESSAGE as Hex },
    primaryType: "Kernel",
    types: { Kernel: [{ name: "hash", type: "bytes32" }] },
    domain: {
      name,
      version,
      chainId: Number(chainId),
      verifyingContract: accountAddress,
    },
  });
  // Same framing createKernelAccount.signMessage applies: the plugin
  // manager's identifier (VALIDATOR_TYPE.PERMISSION || permissionId).
  const framed = concatHex([
    kernelAccount.kernelPluginManager.getIdentifier(),
    innerSignature,
  ]);
  // Same ERC-6492 wrap viem's toSmartAccount applies while the account is
  // not deployed (getFactoryArgs returns undefined once it is).
  const { factory, factoryData } = await kernelAccount.getFactoryArgs();
  const signature =
    factory && factoryData
      ? serializeErc6492Signature({
          address: factory,
          data: factoryData,
          signature: framed,
        })
      : framed;

  writeFileSync(
    new URL("../../python/tests/fixtures/session_key_golden.json", import.meta.url),
    JSON.stringify(
      {
        owner: ownerAccount.address,
        kernelAccountAddress: await kernelAccount.getAddress(),
        sessionKeyPrivateKey: SESSION_KEY_PRIVATE_KEY,
        sessionKeyAddress: sessionKeyAccount.address,
        policy: { allowedCaller: CTF_EXCHANGE_V2, validUntil: VALID_UNTIL },
        orderDigest: ORDER_DIGEST_MESSAGE,
        signature,
      },
      null,
      2
    )
  );
  console.log("wrote python/tests/fixtures/session_key_golden.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
