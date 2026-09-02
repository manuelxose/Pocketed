import time

import polymarket_auth
import session_key


def test_create_signed_order_uses_session_key_when_active(tmp_path, monkeypatch):
    monkeypatch.setenv("POCKETED_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    polymarket_auth.save_credentials(
        "0x" + "11" * 32, funder="0x00000000000000000000000000000000000000aa",
        signature_type=polymarket_auth.SIGNATURE_TYPE_POLY_1271,
    )

    kernel_address = "0x00000000000000000000000000000000000000Bb"
    owner_address = "0x00000000000000000000000000000000000000Dd"
    address, priv_hex = session_key.generate_session_key()
    policy = {
        "allowedCaller": polymarket_auth.EXCHANGE_ADDRESS,
        "validUntil": int(time.time()) + 3600,
        "dailyUsdCap": 1000.0,
        "kernelAddress": kernel_address,
        "ownerAddress": owner_address,
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

    # Prove owner_address was actually threaded from policy["ownerAddress"]
    # (not, say, coincidentally reused from kernelAddress/funder): the
    # ERC-6492 counterfactual-deploy wrapper embeds the owner address in its
    # factory call data, which we can recompute independently.
    _, expected_factory_data = session_key.build_kernel_factory_args(owner_address)
    sig_bytes = bytes.fromhex(order["signature"][2:])
    assert expected_factory_data in sig_bytes


def test_sell_orders_do_not_consume_the_daily_spend_cap(tmp_path, monkeypatch):
    """The cap limits USDC *spend*; a SELL returns collateral. Charging it
    to the cap let a day of selling exhaust the buying budget."""
    monkeypatch.setenv("POCKETED_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    polymarket_auth.save_credentials(
        "0x" + "33" * 32, funder="0x00000000000000000000000000000000000000aa",
        signature_type=polymarket_auth.SIGNATURE_TYPE_POLY_1271,
    )
    address, priv_hex = session_key.generate_session_key()
    policy = {
        "allowedCaller": polymarket_auth.EXCHANGE_ADDRESS,
        "validUntil": int(time.time()) + 3600,
        "dailyUsdCap": 10.0,
        "kernelAddress": "0x00000000000000000000000000000000000000Bb",
        "ownerAddress": "0x00000000000000000000000000000000000000Dd",
    }
    session_key.store_session_key(address, priv_hex, policy, "0xsig")

    # A SELL far above the cap still goes through and reserves nothing...
    polymarket_auth.create_signed_order(
        token_id="123", side="SELL", price=0.5, size=1000, neg_risk=False,
    )
    assert (session_key.load_session_key_record().get("dailySpend") or {}).get("usedUsd", 0.0) == 0.0

    # ...leaving the whole budget available to BUYs, which do consume it.
    polymarket_auth.create_signed_order(
        token_id="123", side="BUY", price=0.5, size=10, neg_risk=False,
    )
    assert session_key.load_session_key_record()["dailySpend"]["usedUsd"] == 5.0

    import pytest
    with pytest.raises(RuntimeError, match="daily USD cap exceeded"):
        polymarket_auth.create_signed_order(
            token_id="123", side="BUY", price=0.5, size=100, neg_risk=False,
        )


def test_create_signed_order_falls_back_to_desktop_flow_without_session_key(tmp_path, monkeypatch):
    monkeypatch.setenv("POCKETED_USERDATA", str(tmp_path))
    polymarket_auth.reset_credential_cache()
    polymarket_auth.save_credentials(
        "0x" + "22" * 32, funder="0x00000000000000000000000000000000000000cc",
        signature_type=polymarket_auth.SIGNATURE_TYPE_POLY_1271,
    )
    order = polymarket_auth.create_signed_order(
        token_id="123", side="BUY", price=0.5, size=10, neg_risk=False,
    )
    assert order["maker"].lower() == "0x00000000000000000000000000000000000000cc"
