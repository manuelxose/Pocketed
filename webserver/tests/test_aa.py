import httpx
import pytest
import respx

from webserver import aa


@pytest.mark.asyncio
@respx.mock
async def test_compute_account_address_returns_address():
    respx.get("http://aa-service.test/account/0xABC").mock(
        return_value=httpx.Response(200, json={"address": "0xDEF"})
    )

    address = await aa.compute_account_address("0xABC", base_url="http://aa-service.test")

    assert address == "0xDEF"


@pytest.mark.asyncio
@respx.mock
async def test_compute_account_address_raises_on_error():
    respx.get("http://aa-service.test/account/0xBAD").mock(
        return_value=httpx.Response(400, json={"error": "invalid owner"})
    )

    with pytest.raises(aa.AAServiceError, match="invalid owner"):
        await aa.compute_account_address("0xBAD", base_url="http://aa-service.test")


@pytest.mark.asyncio
@respx.mock
async def test_build_user_op_returns_userop_and_hash():
    respx.post("http://aa-service.test/userop/build").mock(
        return_value=httpx.Response(200, json={"userOp": {"sender": "0xABC"}, "userOpHash": "0x1"})
    )

    result = await aa.build_user_op(
        "0xABC", [{"to": "0xDEF", "value": "0", "data": "0x"}], base_url="http://aa-service.test"
    )

    assert result == {"userOp": {"sender": "0xABC"}, "userOpHash": "0x1"}


@pytest.mark.asyncio
@respx.mock
async def test_submit_user_op_returns_hash():
    respx.post("http://aa-service.test/userop/submit").mock(
        return_value=httpx.Response(200, json={"userOpHash": "0x1"})
    )

    result = await aa.submit_user_op({"sender": "0xABC"}, base_url="http://aa-service.test")

    assert result == {"userOpHash": "0x1"}


@pytest.mark.asyncio
@respx.mock
async def test_get_user_op_status_returns_status():
    respx.get("http://aa-service.test/userop/0x1/status").mock(
        return_value=httpx.Response(200, json={"status": "pending"})
    )

    result = await aa.get_user_op_status("0x1", base_url="http://aa-service.test")

    assert result == {"status": "pending"}
