# MegaETH Payment Demo

Next.js 16 + wagmi v2 + RainbowKit scaffold. Targets MegaETH testnet (chain id `6343`, returned by `carrot.megaeth.com/rpc`). Will host x402 and mpp payment demos.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind v4)
- wagmi v2 + viem 2 + RainbowKit
- Server-side viem wallet for on-chain writes (relayer/sponsor)

## Setup

```bash
pnpm install
cp .env.example .env.local
# fill NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID and (optional) SERVER_PRIVATE_KEY
pnpm dev
```

Open http://localhost:3000.

## Env

| Var | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | client | RainbowKit / WalletConnect |
| `NEXT_PUBLIC_MEGAETH_RPC_URL` | client | viem transport for wagmi (optional) |
| `MEGAETH_RPC_URL` | server | viem transport for backend (optional) |
| `SERVER_PRIVATE_KEY` | server | hex key for backend signer; required for `/api/relay`, `/api/faucet`, x402 gas sponsorship, MPP gasless charge settlement, and MPP session close |
| `NEXT_PUBLIC_USDM_ADDRESS` | client + server | USDm token address (shared by x402 / mpp / mpp-session) |
| `PAY_TO` | server | Recipient of all USDm payments (falls back to server signer address) |
| `MPP_SECRET_KEY` | server | HMAC secret for mppx 402 challenges (required for `/api/mpp/charge` and `/api/mpp/gasless-charge`) |
| `MPP_CHARGE_AMOUNT` | server | Human-readable USDm amount (default `1`) |
| `MPP_GASLESS_CHARGE_AMOUNT` | server | Human-readable USDm amount for the gasless MPP charge (defaults to `MPP_CHARGE_AMOUNT`, then `1`) |
| `NEXT_PUBLIC_MPP_GASLESS_TOKEN_VERSION` | client + server | Optional EIP-2612 token domain version override for permit20 signing; by default the route reads `eip712Domain()` from the token, then falls back to `NEXT_PUBLIC_X402_TOKEN_VERSION` / `1` |
| `NEXT_PUBLIC_MPP_SESSION_ESCROW` | client + server | Deployed TempoStreamChannelEvm escrow used by `/api/mpp/session` and `/api/mpp/session-gasless` |
| `MPP_SESSION_STATE_REDIS_REST_URL` | server | Upstash/Vercel Redis REST URL for durable MPP session channel state; use `UPSTASH_REDIS_REST_URL` or `KV_REST_API_URL` as alternatives |
| `MPP_SESSION_STATE_REDIS_REST_TOKEN` | server | Upstash/Vercel Redis REST token for durable MPP session channel state; use `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_TOKEN` as alternatives |
| `MPP_SESSION_STATE_KEY_PREFIX` | server | Optional Redis key prefix for MPP session channels (default `mpp-session:channel:`) |
| `MPP_SESSION_ALLOW_MEMORY_STORE` | server | Set to `1` only for throwaway Vercel demos that accept losing channel state across instances |

## Routes

- `GET /api/health` — chain id, latest block, server signer address
- `POST /api/relay` — broadcast a pre-signed raw transaction (`{ rawTx: "0x..." }`)
- `GET /api/mpp/charge` — MPP `tempo.charge` protected endpoint; plain ERC20 transfer, client pays gas
- `GET /api/mpp/gasless-charge` — custom MPP `permit20.charge` protected endpoint; client signs EIP-2612 permit, server pays gas for `permit` + `transferFrom`
- `POST /api/mpp/session` — official-style MPP `tempo.session` pay-as-you-go endpoint; client wallet pays gas for `open` and `topUp`, server verifies vouchers and calls `close`
- `POST /api/mpp/session-gasless` — Permit2 relayed MPP `tempo.session` endpoint; server pays gas for `openWithPermit2`, `topUpWithPermit2`, and `close`

## Production Hardening Caveats

This repository is a reference demo. Some server-side deployment controls are
intentionally omitted to keep the payment flows easy to inspect:

- The local x402 facilitator HTTP route is not authenticated. The default app
  path can use the in-process facilitator, but any production deployment that
  exposes `/api/x402/facilitator/verify` or `/api/x402/facilitator/settle` must
  protect those endpoints with server-to-server authentication, platform access
  controls, an allowlist, or a private network boundary.
- `SERVER_PRIVATE_KEY` is reused by the server-sponsored flows and is created
  without signer-scoped nonce management. Production relayers should add a
  transaction queue or nonce manager per signer, or split duties across separate
  signers so concurrent sponsored writes cannot race the same nonce.
- Server-sponsored demo endpoints such as `/api/faucet`,
  `/api/mpp/gasless-charge`, and `/api/mpp/session-gasless` pay gas from the
  server signer. Production deployments must add authentication, rate limiting,
  per-wallet/IP quotas, spend caps, monitoring, and a circuit breaker. The faucet
  is a development convenience and should be disabled or protected outside a
  throwaway demo.

## Docs

- [x402 current scheme](docs/x402-current-scheme.md) — x402 exact payment flow, Permit2 transfer method, and EIP-2612 gas sponsorship.
- [MPP charge current scheme](docs/mpp-charge-current-scheme.md) — one-time charge flow, push mode, and gasless pull mode.
- [MPP session current scheme](docs/mpp-session-current-scheme.md) — official-style pay-as-you-go lifecycle, gasless EVM relayer flow, and escrow contract method diff.

## MPP session production state

`/api/mpp/session` and `/api/mpp/session-gasless` keep the highest accepted
voucher for each channel so close settles the correct cumulative amount. Local
development can use the in-memory fallback, but serverless production cannot
rely on module memory because a close request may run on a different instance
from the open/voucher requests.

On Vercel, configure an Upstash/Vercel Redis REST database by setting either:

- `MPP_SESSION_STATE_REDIS_REST_URL` and `MPP_SESSION_STATE_REDIS_REST_TOKEN`
- or the marketplace-provided `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- or older `KV_REST_API_URL` / `KV_REST_API_TOKEN`

Without one of those pairs, the route reports missing env in readiness on Vercel.
For non-Vercel serverless hosts, set `MPP_SESSION_REQUIRE_DURABLE_STORE=1` to
fail fast when the durable store is missing.

## Chain

MegaETH testnet — chain id `6343` (live RPC), RPC `https://carrot.megaeth.com/rpc`, explorer `https://www.megaexplorer.xyz`. Faucet via [testnet.megaeth.com](https://testnet.megaeth.com).
