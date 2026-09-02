"""Minimal stand-in for python/service.py's stdio JSON-RPC contract, used
by supervisor tests so they don't depend on the full trading backend's
dependencies (py_clob_client_v2, keyring, etc.) being installed."""
import json
import sys


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main() -> None:
    _send({"type": "event", "name": "backend:ready", "data": {}})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        if req.get("type") != "rpc":
            continue
        method = req.get("method")
        if method == "shutdown":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": None})
            return
        if method == "ping":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": {"pong": True}})
            continue
        if method == "crash":
            sys.exit(1)
        if method == "mintSessionKey":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": {
                "sessionKeyAddress": "0xSessionKeyDummy00000000000000000000000",
                "enableTypedData": {"domain": {}, "message": {"sessionKeyAddress": "0xSessionKeyDummy00000000000000000000000"}},
            }})
            continue
        if method == "activateSessionKey":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": {"ok": True}})
            continue
        if method == "revokeSessionKey":
            _send({"type": "rpc", "id": req["id"], "ok": True, "result": {"ok": True}})
            continue
        _send({"type": "rpc", "id": req["id"], "ok": False, "error": f"unknown method {method}"})


if __name__ == "__main__":
    main()
