from __future__ import annotations

import os

import httpx

AA_SERVICE_URL_ENV = "KRYPT_POLYBOT_AA_SERVICE_URL"


class AAServiceError(Exception):
    """Raised when aa-service returns an error or is unreachable."""


def _resolve_base_url(base_url: str | None) -> str:
    if base_url:
        return base_url
    url = os.environ.get(AA_SERVICE_URL_ENV)
    if not url:
        raise AAServiceError(
            f"{AA_SERVICE_URL_ENV} must be set — refusing to call aa-service without it"
        )
    return url


async def compute_account_address(owner: str, *, base_url: str | None = None) -> str:
    url = _resolve_base_url(base_url)
    async with httpx.AsyncClient(base_url=url, timeout=10.0) as client:
        try:
            resp = await client.get(f"/account/{owner}")
        except httpx.HTTPError as e:
            raise AAServiceError(f"aa-service unreachable: {e}") from e
    if resp.status_code != 200:
        detail = resp.json().get("error", resp.text) if resp.content else resp.text
        raise AAServiceError(f"aa-service error ({resp.status_code}): {detail}")
    return resp.json()["address"]
