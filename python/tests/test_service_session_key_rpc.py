import asyncio

import service


def test_mint_then_activate_session_key(tmp_path, monkeypatch):
    monkeypatch.setenv("KRYPT_POLYBOT_USERDATA", str(tmp_path))
    kernel_address = "0x000000000000000000000000000000000000Bb"
    allowed_caller = "0xE111180000d2663C0091e4f400237545B87B996B"
    owner_address = "0x1111180000d2663C0091e4f400237545B87B9AA"

    mint_result = asyncio.run(service._h_mintSessionKey({
        "kernelAddress": kernel_address, "allowedCaller": allowed_caller,
        "validUntil": 1893456000, "dailyUsdCap": 50.0,
        "ownerAddress": owner_address,
    }))
    assert mint_result["sessionKeyAddress"].startswith("0x")
    assert mint_result["enableTypedData"]["message"]["sessionKeyAddress"] == mint_result["sessionKeyAddress"]

    activate_result = asyncio.run(service._h_activateSessionKey({"signature": "0xdeadsignature"}))
    assert activate_result == {"ok": True}

    import session_key
    record = session_key.load_active_session_key()
    assert record is not None
    assert record["address"] == mint_result["sessionKeyAddress"]
    assert record["policy"]["ownerAddress"] == owner_address

    revoke_result = asyncio.run(service._h_revokeSessionKey({}))
    assert revoke_result == {"ok": True}
    assert session_key.load_active_session_key() is None
