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
