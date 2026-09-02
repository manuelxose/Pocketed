import json
from pathlib import Path

import session_key

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "session_key_golden.json").read_text()
)


def test_sign_order_as_session_key_matches_golden_fixture():
    digest = bytes.fromhex(FIXTURE["orderDigest"][2:])
    signature = session_key.sign_order_as_session_key(
        digest,
        FIXTURE["sessionKeyPrivateKey"],
        kernel_account_address=FIXTURE["kernelAccountAddress"],
        policy=FIXTURE["policy"],
        owner_address=FIXTURE["owner"],
    )
    assert signature.lower() == FIXTURE["signature"].lower()


def test_permission_id_matches_golden_fixture():
    """The 4-byte permission id is embedded in the golden signature right
    after the 0x02 validation-type byte of the inner (unwrapped) signature."""
    permission_id = session_key.compute_permission_id(
        FIXTURE["sessionKeyAddress"], FIXTURE["policy"]
    )
    assert permission_id.hex() in FIXTURE["signature"].lower()
