"""Kernel v0.3.1 session keys (Fase 2b).

╔══════════════════════════════════════════════════════════════════════════╗
║ KNOWN BLOCKING GAP — the permission validator is NEVER installed on-chain║
╚══════════════════════════════════════════════════════════════════════════╝

`sign_order_as_session_key()` produces a signature framed as
`0x02 || permissionId || 0xff || <session key sig over Kernel's EIP-712
wrap>`. That framing tells the Kernel account "route this ERC-1271 check to
the permission validator registered under `permissionId`".

NOTHING IN THIS CODEBASE EVER REGISTERS THAT PERMISSION VALIDATOR ON-CHAIN:

  * `build_kernel_factory_args()` below deploys the account with an EMPTY
    `initConfig` (`bytes[] initConfig = []`) — i.e. only the ECDSA sudo
    (owner) validator, no permission validator, no policies.
  * `aa-service/src/kernelAccount.ts` deliberately builds the account with
    "no hook plugin, no initConfig" so the counterfactual address stays
    stable; nothing there installs a validator either.
  * ZeroDev's SDK only auto-inserts an "enable" branch on the
    `signUserOperation` path (see `@zerodev/sdk`'s
    `toKernelPluginManager.js`). The `signTypedData` / ERC-1271 path — the
    one Polymarket's CTF Exchange uses — has no such branch, so there is no
    just-in-time enable either.

Consequence: on a real chain, `isValidSignature()` on the Kernel account
would look up `permissionId` and find no config, and the order signature
would be REJECTED. Everything in this module is byte-for-byte correct
against ZeroDev's own SDK output (see `tests/fixtures/session_key_golden.json`)
but that only proves the encoding matches — not that the account will accept
it. Do not describe session-key expiry / allowed-caller restrictions as
"contract-enforced" until this gap is closed.

Two viable ways to close it (both out of scope for the current fix wave):
  1. Install at deploy time: include the permission validator's install
     blob in `initConfig` here AND in `aa-service/src/kernelAccount.ts`.
     This CHANGES the counterfactual account address, so it must be done
     before any account is funded, and both implementations must agree
     byte-for-byte or the addresses diverge.
  2. Install after deploy: build a one-time UserOp (reusing the Fase 2a
     `/aa/test-userop/build|submit` plumbing) signed by the owner's live
     wallet that calls Kernel's `installModule` with the real enable
     calldata from `@zerodev/permissions`. Leaves the address untouched but
     needs the account deployed and gas-funded first.

Separately, `build_enable_typed_data()` is a LOCAL consent record only —
see its docstring. It authorizes nothing on-chain.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

import polymarket_auth as _auth

# --- Kernel v0.3.1 / EntryPoint v0.7 on-chain constants -------------------
# Mirrored from the installed @zerodev/sdk and @zerodev/permissions packages
# (aa-service/node_modules/@zerodev/*/_cjs/constants.js). These are the
# canonical, chain-agnostic deployment addresses used by ZeroDev.
KERNEL_NAME = "Kernel"
KERNEL_VERSION = "0.3.1"
# @zerodev/sdk KERNEL_ADDRESSES.FACTORY_STAKER (the "meta factory")
KERNEL_META_FACTORY = "0xd703aaE79538628d27099B8c4f621bE4CCd142d5"
# @zerodev/sdk KernelVersionToAddressesMap["0.3.1"].factoryAddress
KERNEL_FACTORY_V0_3_1 = "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419"
# @zerodev/ecdsa-validator: the sudo (owner) validator for Kernel v0.3.1
KERNEL_ECDSA_VALIDATOR_V0_3_1 = "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57"
# @zerodev/permissions constants.js
ECDSA_SIGNER_CONTRACT = "0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF"
SIGNATURE_CALLER_POLICY_CONTRACT = "0xF6A936c88D97E6fad13b98d2FD731Ff17eeD591d"
TIMESTAMP_POLICY_CONTRACT = "0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F"
# PolicyFlags.FOR_ALL_VALIDATION
POLICY_FLAG_FOR_ALL_VALIDATION = bytes.fromhex("0000")
# @zerodev/sdk VALIDATOR_TYPE.PERMISSION / .SECONDARY
VALIDATOR_TYPE_PERMISSION = bytes.fromhex("02")
VALIDATOR_TYPE_SECONDARY = bytes.fromhex("01")
# @zerodev/permissions toPermissionValidator: marker that the signature that
# follows is the permission signer's own signature (no policy signatures).
PERMISSION_SIGNER_SIGNATURE_FLAG = bytes.fromhex("ff")
# ERC-6492 magic suffix (0x6492...6492)
ERC6492_MAGIC_SUFFIX = bytes.fromhex("6492" * 16)


# --- minimal ABI encoding helpers (avoids a hard eth-abi dependency) ------
def _u256(n: int) -> bytes:
    return int(n).to_bytes(32, "big")


def _addr_bytes(addr: str) -> bytes:
    a = addr[2:] if addr.lower().startswith("0x") else addr
    b = bytes.fromhex(a)
    if len(b) != 20:
        raise ValueError(f"not a 20-byte address: {addr}")
    return b


def _addr_word(addr: str) -> bytes:
    return _addr_bytes(addr).rjust(32, b"\x00")


def _pad_right(b: bytes) -> bytes:
    return b + b"\x00" * ((32 - len(b) % 32) % 32)


def _tail_bytes(b: bytes) -> bytes:
    """Tail encoding of a dynamic `bytes` value: length word + padded data."""
    return _u256(len(b)) + _pad_right(b)


def _tail_bytes_array(items: list[bytes]) -> bytes:
    """Tail encoding of a `bytes[]` value."""
    head = _u256(len(items))
    offsets = b""
    tail = b""
    base = 32 * len(items)
    for it in items:
        offsets += _u256(base + len(tail))
        tail += _tail_bytes(it)
    return head + offsets + tail


def _encode_bytes_array(items: list[bytes]) -> bytes:
    """abi.encode(bytes[]) as a standalone parameter list."""
    return _u256(32) + _tail_bytes_array(items)


def _encode_bytes(value: bytes) -> bytes:
    """abi.encode(bytes) as a standalone parameter list."""
    return _u256(32) + _tail_bytes(value)


def _encode_address_array(addrs: list[str]) -> bytes:
    """abi.encode(address[]) as a standalone parameter list."""
    return _u256(32) + _u256(len(addrs)) + b"".join(_addr_word(a) for a in addrs)


def allowed_callers(policy: dict) -> list[str]:
    """The full list of contracts this session key may be called through.

    `@zerodev/permissions`' `toSignatureCallerPolicy({allowedCallers: [...]})`
    takes an ARRAY, so a policy may legitimately pin several callers — the
    Polymarket CTF Exchange has two of them (the regular exchange and the
    neg-risk exchange), and an order routed to the wrong one would be
    rejected by the policy. Accepts either the newer `allowedCallers` list
    or the original single `allowedCaller` (kept for stored records written
    before the list form existed)."""
    callers = policy.get("allowedCallers")
    if callers:
        return [str(c) for c in callers]
    return [str(policy["allowedCaller"])]


def _policy_blobs(policy: dict) -> list[bytes]:
    """The `policyInfo || policyData` blobs for the two policies the
    aa-service installs on a session key: a SignatureCallerPolicy pinning
    the allowed caller(s) (the Polymarket CTF Exchange contracts) and a
    TimestampPolicy carrying the expiry. Order matters — it feeds the
    permission id hash."""
    flag = POLICY_FLAG_FOR_ALL_VALIDATION
    caller_info = flag + _addr_bytes(SIGNATURE_CALLER_POLICY_CONTRACT)
    caller_data = _encode_address_array(allowed_callers(policy))
    ts_info = flag + _addr_bytes(TIMESTAMP_POLICY_CONTRACT)
    # toTimestampPolicy encodes (uint48 validAfter, uint48 validUntil)
    ts_data = _u256(int(policy.get("validAfter") or 0)) + _u256(int(policy["validUntil"]))
    return [caller_info + caller_data, ts_info + ts_data]


def compute_permission_id(session_key_address: str, policy: dict) -> bytes:
    """The 4-byte permission id Kernel uses to route ERC-1271 verification
    to this session key's permission validator.

    Mirrors `toPermissionValidator().getIdentifier()` in
    @zerodev/permissions: keccak256 of abi.encode(bytes[]) over
    [toPolicyId(policies), policyFlag, toSignerId(signer)], truncated to
    4 bytes."""
    from eth_utils import keccak

    policy_id = _encode_bytes_array(_policy_blobs(policy))
    signer_id = _encode_bytes(
        _addr_bytes(ECDSA_SIGNER_CONTRACT) + _addr_bytes(session_key_address)
    )
    pid_data = _encode_bytes_array(
        [policy_id, POLICY_FLAG_FOR_ALL_VALIDATION, signer_id]
    )
    return keccak(pid_data)[:4]


def build_kernel_factory_args(owner_address: str, index: int = 0) -> tuple[str, bytes]:
    """(factory, factoryData) for a counterfactual (not yet deployed) Kernel
    v0.3.1 account owned by `owner_address`, as ERC-6492 needs them.

    Mirrors @zerodev/sdk `getAccountInitCode` for EntryPoint 0.7 with the
    meta factory: deployWithFactory(address factory, bytes createData,
    bytes32 salt) where createData is
    initialize(bytes21 rootValidator, address hook, bytes validatorData,
    bytes hookData, bytes[] initConfig).

    KNOWN GAP (see the module docstring): `initConfig` is EMPTY here, so the
    deployed account has only the owner's ECDSA sudo validator installed —
    NO permission validator for any session key. Must stay byte-identical to
    `aa-service/src/kernelAccount.ts`'s account construction, or the
    counterfactual address computed here and there diverge."""
    from eth_utils import keccak

    init_selector = keccak(b"initialize(bytes21,address,bytes,bytes,bytes[])")[:4]
    # rootValidator identifier: VALIDATOR_TYPE.SECONDARY || validator address
    root_validator = VALIDATOR_TYPE_SECONDARY + _addr_bytes(
        KERNEL_ECDSA_VALIDATOR_V0_3_1
    )
    validator_data = _addr_bytes(owner_address)  # ECDSA validator enable data
    head = (
        _pad_right(root_validator)  # bytes21, left-aligned in its word
        + _addr_word("0x" + "00" * 20)  # hook = zero address
        + _u256(5 * 32)  # offset: validatorData
        + _u256(5 * 32 + 64)  # offset: hookData ("0x")
        + _u256(5 * 32 + 64 + 32)  # offset: initConfig ([])
    )
    init_data = (
        init_selector
        + head
        + _tail_bytes(validator_data)
        + _tail_bytes(b"")
        + _u256(0)  # empty bytes[] initConfig
    )

    deploy_selector = keccak(b"deployWithFactory(address,bytes,bytes32)")[:4]
    factory_data = (
        deploy_selector
        + _addr_word(KERNEL_FACTORY_V0_3_1)
        + _u256(3 * 32)  # offset: createData
        + _u256(index)  # salt
        + _tail_bytes(init_data)
    )
    return KERNEL_META_FACTORY, factory_data


def sign_order_as_session_key(
    digest: bytes,
    session_key_private_key_hex: str,
    kernel_account_address: str,
    policy: dict,
    owner_address: Optional[str] = None,
    chain_id: Optional[int] = None,
    account_deployed: bool = False,
) -> str:
    """Sign `digest` (a 32-byte, already-hashed EIP-712 message) with the
    session key so Kernel's `isValidSignature` accepts it.

    Reproduces, byte for byte, what ZeroDev's TypeScript SDK produces for a
    Kernel v0.3.1 / EntryPoint v0.7 account whose active validator is a
    permission validator (the session key):

      1. Wrap the RAW digest in Kernel's own EIP-712 `Kernel(bytes32 hash)`
         struct, domain {name: "Kernel", version: "0.3.1", chainId,
         verifyingContract: the Kernel account address}, and sign it with
         the session key.
      2. Prefix `0xff` (permission validator: signer signature follows).
      3. Prefix the validation id: 0x02 || permissionId(4 bytes).
      4. If the Kernel account is not deployed yet, wrap the whole thing in
         an ERC-6492 signature carrying the account's deploy factory call,
         so a verifier can counterfactually deploy and then check it.

    KNOWN GAP — `account_deployed`: every caller currently hardcodes
    `account_deployed=False` (see
    `polymarket_auth._create_signed_order_via_session_key`), so an ERC-6492
    wrapper is emitted unconditionally. That is correct only while the
    Kernel account really is counterfactual. Once it is deployed (Fase 2a's
    funding flow deploys it), a plain ERC-1271 verifier that does not
    understand the 0x6492 magic suffix will reject the signature. A real fix
    needs a deployment check — an `eth_getCode(kernelAddress) != 0x` probe
    exposed by aa-service and cached per account — which is new plumbing
    this module does not have.

    Note there is deliberately NO EIP-191 personal-sign prefix over the
    digest. ZeroDev's `signMessage({message:{raw}})` applies one, but the
    Polymarket CTF Exchange calls `isValidSignature(orderHash, sig)` with
    the raw order hash and Kernel's ERC1271 wraps that hash directly.

    Cross-checked against `tests/fixtures/session_key_golden.json`, which is
    generated by the real ZeroDev SDK.

    KNOWN BLOCKING GAP (see the module docstring): the `permissionId` this
    signature routes to has no configuration on the Kernel account, because
    nothing in this codebase installs the permission validator on-chain.
    The bytes are right; an on-chain verifier would still reject them.
    """
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    if len(digest) != 32:
        raise ValueError(f"digest must be 32 bytes, got {len(digest)}")
    if chain_id is None:
        chain_id = _auth.CHAIN_ID

    acct = Account.from_key(session_key_private_key_hex)

    # 1. Kernel's EIP-712 wrap over the raw digest, signed by the session key.
    signed = acct.sign_message(
        encode_typed_data(
            full_message={
                "types": {
                    "EIP712Domain": [
                        {"name": "name", "type": "string"},
                        {"name": "version", "type": "string"},
                        {"name": "chainId", "type": "uint256"},
                        {"name": "verifyingContract", "type": "address"},
                    ],
                    "Kernel": [{"name": "hash", "type": "bytes32"}],
                },
                "primaryType": "Kernel",
                "domain": {
                    "name": KERNEL_NAME,
                    "version": KERNEL_VERSION,
                    "chainId": int(chain_id),
                    "verifyingContract": kernel_account_address,
                },
                "message": {"hash": "0x" + digest.hex()},
            }
        )
    )

    # 2 + 3. Permission-validator + Kernel validation-id framing.
    permission_id = compute_permission_id(acct.address, policy)
    signature = (
        VALIDATOR_TYPE_PERMISSION
        + permission_id
        + PERMISSION_SIGNER_SIGNATURE_FLAG
        + bytes(signed.signature)
    )

    # 4. ERC-6492 wrap while the Kernel account is still counterfactual.
    if not account_deployed:
        if not owner_address:
            raise ValueError(
                "owner_address is required to build the ERC-6492 deploy wrapper "
                "for a Kernel account that is not deployed yet"
            )
        factory, factory_data = build_kernel_factory_args(owner_address)
        signature = (
            _addr_word(factory)
            + _u256(3 * 32)
            + _u256(3 * 32 + len(_tail_bytes(factory_data)))
            + _tail_bytes(factory_data)
            + _tail_bytes(signature)
            + ERC6492_MAGIC_SUFFIX
        )

    return "0x" + signature.hex()


def generate_session_key() -> tuple[str, str]:
    """Generates a fresh ephemeral ECDSA keypair for use as a Kernel
    session key. Returns (address, private_key_hex) — the private key is
    never persisted in plaintext by this function; callers must pass it
    straight to store_session_key()."""
    from eth_account import Account
    acct = Account.create()
    priv = acct.key.hex()
    if not priv.startswith("0x"):
        priv = "0x" + priv
    return acct.address, priv


def session_key_file(env: str = _auth.NETWORK) -> Path:
    return _auth._credentials_dir() / f"sessionkey.{_auth._validate_env(env)}.json"


def store_session_key(
    address: str, private_key_hex: str, policy: dict, enable_signature: str,
    env: str = _auth.NETWORK,
) -> None:
    record = {
        "address": address,
        "privateKey": private_key_hex,
        "policy": policy,
        "enableSignature": enable_signature,
        "active": True,
        "createdAt": int(time.time()),
    }
    _auth._write_secret_bytes(session_key_file(env), json.dumps(record).encode("utf-8"))


def load_session_key_record(env: str = _auth.NETWORK) -> Optional[dict]:
    f = session_key_file(env)
    if not f.exists():
        return None
    try:
        data = json.loads(_auth._read_secret_bytes(f).decode("utf-8", "replace"))
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("address") or not data.get("privateKey"):
        return None
    return data


def build_enable_typed_data(kernel_address: str, session_key_address: str, policy: dict) -> dict:
    """EIP-712 payload the owner signs once via `eth_signTypedData_v4` to
    record their consent to `session_key_address` trading on their behalf,
    restricted to `allowed_callers(policy)` (the Polymarket CTF Exchange
    contracts) and expiring at `policy['validUntil']`.

    ⚠ THIS IS A LOCAL CONSENT RECORD ONLY — NOT AN ON-CHAIN PAYLOAD. ⚠

    The `EnableSessionKey` struct and the "Krypt PolyBot Session Key" domain
    below are bespoke to this application. They have NO relationship to
    Kernel's real plugin-enable typed data (`@zerodev/sdk`'s
    `ValidatorApproved` / `Enable` struct over
    `(bytes21 validator, uint256 nonce, address hook, bytes validatorData,
    bytes hookData, bytes selectorData)`), and signing this authorizes
    NOTHING on-chain. Its only purpose is to prove, locally and verifiably
    (see `recover_enable_signer` below), that the owner of the Kernel
    account actually asked for this session key — which is what
    `/session-key/activate` checks before it will store the key. Installing
    the validator on-chain is a separate, unimplemented step; see the module
    docstring's KNOWN BLOCKING GAP.
    """
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "EnableSessionKey": [
                {"name": "sessionKeyAddress", "type": "address"},
                {"name": "allowedCallers", "type": "address[]"},
                {"name": "validUntil", "type": "uint256"},
            ],
        },
        "primaryType": "EnableSessionKey",
        "domain": {
            "name": "Krypt PolyBot Session Key",
            "version": "1",
            "chainId": _auth.CHAIN_ID,
            "verifyingContract": kernel_address,
        },
        "message": {
            "sessionKeyAddress": session_key_address,
            "allowedCallers": allowed_callers(policy),
            "validUntil": int(policy["validUntil"]),
        },
    }


def recover_enable_signer(typed_data: dict, signature: str) -> str:
    """Recover the address that produced `signature` over `typed_data` (the
    exact dict `build_enable_typed_data` returned at mint time).

    Uses the same `eth_account` typed-data path the signing side uses, so a
    signature produced by any `eth_signTypedData_v4`-compatible wallet over
    that payload recovers to the wallet's own address. Raises ValueError if
    the signature is malformed or unrecoverable."""
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    sig = (signature or "").strip()
    if not sig:
        raise ValueError("signature is required")
    try:
        return Account.recover_message(
            encode_typed_data(full_message=typed_data), signature=sig
        )
    except Exception as e:
        raise ValueError(f"could not recover signer from signature: {e}") from e


def load_active_session_key(env: str = _auth.NETWORK) -> Optional[dict]:
    record = load_session_key_record(env)
    if record is None or not record.get("active"):
        return None
    valid_until = int(record.get("policy", {}).get("validUntil") or 0)
    if valid_until and _auth.now_ts() >= valid_until:
        return None
    return record


def reserve_daily_usd(amount_usd: float, env: str = _auth.NETWORK) -> bool:
    """Atomically checks and reserves `amount_usd` against the session
    key's policy['dailyUsdCap'] for the current UTC day. Returns False
    (and reserves nothing) if the cap would be exceeded; True and records
    the spend otherwise. The counter resets when the UTC day changes.

    There is deliberately NO "unlimited" cap: a missing or non-positive
    `dailyUsdCap` reserves nothing and returns False (fail closed). Mint
    time rejects such a policy outright (`service._h_mintSessionKey`), so
    a stored record with cap <= 0 is a corrupt/hand-edited one and must not
    be treated as permission to spend without limit."""
    record = load_session_key_record(env)
    if record is None:
        return False
    today = time.strftime("%Y-%m-%d", time.gmtime(_auth.now_ts()))
    spend = record.get("dailySpend") or {}
    if spend.get("day") != today:
        spend = {"day": today, "usedUsd": 0.0}
    cap = float(record.get("policy", {}).get("dailyUsdCap") or 0.0)
    if cap <= 0:
        return False
    if spend["usedUsd"] + amount_usd > cap:
        return False
    spend["usedUsd"] = spend["usedUsd"] + amount_usd
    record["dailySpend"] = spend
    _auth._write_secret_bytes(session_key_file(env), json.dumps(record).encode("utf-8"))
    return True


def revoke_session_key_soft(env: str = _auth.NETWORK) -> None:
    record = load_session_key_record(env)
    if record is None:
        return
    record["active"] = False
    _auth._write_secret_bytes(session_key_file(env), json.dumps(record).encode("utf-8"))
