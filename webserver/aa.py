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


async def build_user_op(owner: str, calls: list[dict], *, base_url: str | None = None) -> dict:
    url = _resolve_base_url(base_url)
    async with httpx.AsyncClient(base_url=url, timeout=15.0) as client:
        try:
            resp = await client.post("/userop/build", json={"owner": owner, "calls": calls})
        except httpx.HTTPError as e:
            raise AAServiceError(f"aa-service unreachable: {e}") from e
    if resp.status_code != 200:
        raise AAServiceError(f"aa-service error ({resp.status_code}): {resp.json().get('error', resp.text)}")
    return resp.json()


async def submit_user_op(user_op: dict, *, base_url: str | None = None) -> dict:
    url = _resolve_base_url(base_url)
    async with httpx.AsyncClient(base_url=url, timeout=30.0) as client:
        try:
            resp = await client.post("/userop/submit", json={"userOp": user_op})
        except httpx.HTTPError as e:
            raise AAServiceError(f"aa-service unreachable: {e}") from e
    if resp.status_code != 200:
        raise AAServiceError(f"aa-service error ({resp.status_code}): {resp.json().get('error', resp.text)}")
    return resp.json()


async def get_user_op_status(user_op_hash: str, *, base_url: str | None = None) -> dict:
    url = _resolve_base_url(base_url)
    async with httpx.AsyncClient(base_url=url, timeout=10.0) as client:
        try:
            resp = await client.get(f"/userop/{user_op_hash}/status")
        except httpx.HTTPError as e:
            raise AAServiceError(f"aa-service unreachable: {e}") from e
    if resp.status_code != 200:
        raise AAServiceError(f"aa-service error ({resp.status_code}): {resp.json().get('error', resp.text)}")
    return resp.json()
