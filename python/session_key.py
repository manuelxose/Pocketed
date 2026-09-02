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


def _policy_blobs(policy: dict) -> list[bytes]:
    """The `policyInfo || policyData` blobs for the two policies the
    aa-service installs on a session key: a SignatureCallerPolicy pinning
    the allowed caller (the Polymarket CTF Exchange) and a TimestampPolicy
    carrying the expiry. Order matters — it feeds the permission id hash."""
    flag = POLICY_FLAG_FOR_ALL_VALIDATION
    caller_info = flag + _addr_bytes(SIGNATURE_CALLER_POLICY_CONTRACT)
    caller_data = _encode_address_array([policy["allowedCaller"]])
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
    bytes hookData, bytes[] initConfig)."""
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

    Reproduces, byte for byte, what
    `kernelAccount.signMessage({ message: { raw: digest } })` produces in
    ZeroDev's TypeScript SDK for a Kernel v0.3.1 / EntryPoint v0.7 account
    whose active validator is a permission validator (the session key):

      1. EIP-191 hash the raw digest (viem `hashMessage({raw})`).
      2. Wrap that in Kernel's own EIP-712 `Kernel(bytes32 hash)` struct,
         domain {name: "Kernel", version: "0.3.1", chainId,
         verifyingContract: the Kernel account address}, and sign it with
         the session key.
      3. Prefix `0xff` (permission validator: signer signature follows).
      4. Prefix the validation id: 0x02 || permissionId(4 bytes).
      5. If the Kernel account is not deployed yet, wrap the whole thing in
         an ERC-6492 signature carrying the account's deploy factory call,
         so a verifier can counterfactually deploy and then check it.

    Cross-checked against `tests/fixtures/session_key_golden.json`, which is
    generated by the real ZeroDev SDK.
    """
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    from eth_utils import keccak

    if len(digest) != 32:
        raise ValueError(f"digest must be 32 bytes, got {len(digest)}")
    if chain_id is None:
        chain_id = _auth.CHAIN_ID

    acct = Account.from_key(session_key_private_key_hex)

    # 1. viem hashMessage({ raw: digest }) — EIP-191 personal_sign prefix.
    message_hash = keccak(b"\x19Ethereum Signed Message:\n32" + digest)

    # 2. Kernel's EIP-712 wrap, signed by the session key.
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
                "message": {"hash": "0x" + message_hash.hex()},
            }
        )
    )

    # 3 + 4. Permission-validator + Kernel validation-id framing.
    permission_id = compute_permission_id(acct.address, policy)
    signature = (
        VALIDATOR_TYPE_PERMISSION
        + permission_id
        + PERMISSION_SIGNER_SIGNATURE_FLAG
        + bytes(signed.signature)
    )

    # 5. ERC-6492 wrap while the Kernel account is still counterfactual.
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
    """EIP-712 payload the owner signs once via eth_signTypedData_v4 to
    authorize `session_key_address` as a Kernel permission-validator
    signer restricted to `policy['allowedCaller']`
    (the Polymarket CTF Exchange), expiring at `policy['validUntil']`."""
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
                {"name": "allowedCaller", "type": "address"},
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
            "allowedCaller": policy["allowedCaller"],
            "validUntil": int(policy["validUntil"]),
        },
    }


def load_active_session_key(env: str = _auth.NETWORK) -> Optional[dict]:
    record = load_session_key_record(env)
    if record is None or not record.get("active"):
        return None
    valid_until = int(record.get("policy", {}).get("validUntil") or 0)
    if valid_until and _auth.now_ts() >= valid_until:
        return None
    return record


def revoke_session_key_soft(env: str = _auth.NETWORK) -> None:
    record = load_session_key_record(env)
    if record is None:
        return
    record["active"] = False
    _auth._write_secret_bytes(session_key_file(env), json.dumps(record).encode("utf-8"))
