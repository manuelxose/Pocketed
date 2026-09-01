# Self-hosted bundler (Alto)

Runs Pimlico's open-source ERC-4337 bundler against Polygon (mainnet or
Amoy testnet, depending on `POLYGON_RPC_URL`).

## Run it

    cd infra/bundler
    cp .env.example .env   # fill in real values — see below
    docker compose up -d

`BUNDLER_EXECUTOR_PRIVATE_KEY` and `BUNDLER_UTILITY_PRIVATE_KEY` are
operational keys the bundler uses to actually submit UserOps as
transactions and to manage its own stake — they hold gas funds, not user
funds, and are separate from the paymaster's key (`aa-service`'s
`PAYMASTER_PRIVATE_KEY`). Fund them with a small amount of MATIC on
whichever network `POLYGON_RPC_URL` points at.

Verify the docker-compose image tag/flags against Alto's own README before
a real deploy — `pimlico/alto:latest` and the flags above are a starting
point, not guaranteed current as of whenever this is run.

## Verify it's up

    curl -s -X POST http://localhost:4337 \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

Expected: a JSON-RPC response with a `result` hex chain id matching
`POLYGON_RPC_URL`'s network (`0x13882` for Amoy testnet, `0x89` for
Polygon mainnet).
