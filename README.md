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
| `SERVER_PRIVATE_KEY` | server | hex key for backend signer; required for `/api/relay` and `/api/faucet` |
| `NEXT_PUBLIC_USDM_ADDRESS` | client + server | USDm token address (defaults to `0x392C…9a9A`) |
| `MPP_SECRET_KEY` | server | HMAC secret for mppx 402 challenges (required for `/api/mpp/charge`) |
| `MPP_PAY_TO` | server | Recipient of MPP payments (falls back to x402 / server signer) |
| `NEXT_PUBLIC_MPP_PAY_TO` | client | Optional client-visible override |
| `MPP_CHARGE_AMOUNT` | server | Human-readable USDm amount (default `1`) |

## Routes

- `GET /api/health` — chain id, latest block, server signer address
- `POST /api/relay` — broadcast a pre-signed raw transaction (`{ rawTx: "0x..." }`)
- `GET /api/mpp/charge` — MPP `tempo.charge` protected endpoint; returns 402 without a credential, 200 + `Payment-Receipt` with one

## Chain

MegaETH testnet — chain id `6343` (live RPC), RPC `https://carrot.megaeth.com/rpc`, explorer `https://www.megaexplorer.xyz`. Faucet via [testnet.megaeth.com](https://testnet.megaeth.com).
