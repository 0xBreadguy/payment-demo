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
| `SERVER_PRIVATE_KEY` | server | hex key for backend signer; required for `/api/relay`, `/api/faucet`, x402 gas sponsorship, and MPP gasless charge settlement |
| `NEXT_PUBLIC_USDM_ADDRESS` | client + server | USDm token address (shared by x402 / mpp / mpp-session) |
| `PAY_TO` | server | Recipient of all USDm payments (falls back to server signer address) |
| `MPP_SECRET_KEY` | server | HMAC secret for mppx 402 challenges (required for `/api/mpp/charge` and `/api/mpp/gasless-charge`) |
| `MPP_CHARGE_AMOUNT` | server | Human-readable USDm amount (default `1`) |
| `MPP_GASLESS_CHARGE_AMOUNT` | server | Human-readable USDm amount for the gasless MPP charge (defaults to `MPP_CHARGE_AMOUNT`, then `1`) |
| `NEXT_PUBLIC_MPP_GASLESS_TOKEN_NAME` | client + server | Optional EIP-2612 token domain name override for permit20 signing; by default the route reads `eip712Domain()` / `name()` from the token |
| `NEXT_PUBLIC_MPP_GASLESS_TOKEN_VERSION` | client + server | Optional EIP-2612 token domain version override for permit20 signing; by default the route reads `eip712Domain()` from the token, then falls back to `NEXT_PUBLIC_X402_TOKEN_VERSION` / `1` |

## Routes

- `GET /api/health` — chain id, latest block, server signer address
- `POST /api/relay` — broadcast a pre-signed raw transaction (`{ rawTx: "0x..." }`)
- `GET /api/mpp/charge` — MPP `tempo.charge` protected endpoint; plain ERC20 transfer, client pays gas
- `GET /api/mpp/gasless-charge` — custom MPP `permit20.charge` protected endpoint; client signs EIP-2612 permit, server pays gas for `permit` + `transferFrom`

## Chain

MegaETH testnet — chain id `6343` (live RPC), RPC `https://carrot.megaeth.com/rpc`, explorer `https://www.megaexplorer.xyz`. Faucet via [testnet.megaeth.com](https://testnet.megaeth.com).
