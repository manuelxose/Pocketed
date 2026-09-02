import time

import polymarket_auth
import session_key


def test_create_signed_order_uses_session_key_when_active(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    polymarket_auth.save_credentials(
        "0x" + "11" * 32, funder="0x00000000000000000000000000000000000000aa",
        signature_type=polymarket_auth.SIGNATURE_TYPE_POLY_1271,
    )

    kernel_address = "0x00000000000000000000000000000000000000Bb"
    address, priv_hex = session_key.generate_session_key()
    policy = {
        "allowedCaller": polymarket_auth.EXCHANGE_ADDRESS,
        "validUntil": int(time.time()) + 3600,
        "dailyUsdCap": 1000.0,
        "kernelAddress": kernel_address,
    }
    session_key.store_session_key(address, priv_hex, policy, "0xsig")

    order = polymarket_auth.create_signed_order(
        token_id="123", side="BUY", price=0.5, size=10, neg_risk=False,
        salt=42, ts_ms=1_700_000_000_000,
    )

    assert order["maker"].lower() == kernel_address.lower()
    assert order["signer"].lower() == kernel_address.lower()
    assert order["signatureType"] == polymarket_auth.SIGNATURE_TYPE_POLY_1271
    assert order["signature"].startswith("0x")


def test_create_signed_order_falls_back_to_desktop_flow_without_session_key(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    polymarket_auth.save_credentials(
        "0x" + "22" * 32, funder="0x00000000000000000000000000000000000000cc",
        signature_type=polymarket_auth.SIGNATURE_TYPE_POLY_1271,
    )
    order = polymarket_auth.create_signed_order(
        token_id="123", side="BUY", price=0.5, size=10, neg_risk=False,
    )
    assert order["maker"].lower() == "0x00000000000000000000000000000000000000cc"
