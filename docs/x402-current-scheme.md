# x402 Current Scheme

Date: 2026-05-25

## Goal

This document summarizes how the demo uses x402 for one-time protected content
access:

- The normal x402 `402 -> payment payload -> retry` flow.
- The resource server, browser client, and facilitator responsibilities.
- The current `permit2` transfer method and EIP-2612 gas sponsorship setup.

References:

- [x402 README](https://github.com/x402-foundation/x402/blob/main/README.md)
- [x402 EIP-2612 gas sponsoring](https://github.com/x402-foundation/x402/blob/main/docs/extensions/eip2612-gas-sponsoring.mdx)

## Demo Flow

The browser card calls `GET /api/protected`. Without a valid payment, the route
returns `402 Payment Required` with x402 payment requirements. The client then
uses `@x402/fetch` and `ExactEvmScheme` to create a signed EVM payment payload,
retries the same request, and receives the protected JSON response plus the x402
settlement response header.

Current values:

| Item | Value |
| --- | --- |
| Route | `GET /api/protected` |
| Scheme | `exact` |
| Network | `eip155:6343` MegaETH testnet |
| Asset | USDm from `NEXT_PUBLIC_USDM_ADDRESS` |
| Price | `1 USDm` |
| Transfer method | `permit2` |
| Gas sponsorship | `eip2612GasSponsoring` extension |

## Responsibilities

| Actor | Responsibility |
| --- | --- |
| Browser client | Reads the 402 challenge, signs typed data through the connected wallet, and retries the original request with the x402 payment payload. |
| Resource server | Declares price, network, token, recipient, transfer method, and extensions; verifies payment before returning protected content. |
| Facilitator | Verifies and settles the EVM payment, submits on-chain transactions, and waits for confirmation. |

In this app the resource server is the Next.js route using `withX402`. The
facilitator can run locally through `/api/x402/facilitator/[action]`, backed by
`SERVER_PRIVATE_KEY`, or be replaced with `X402_FACILITATOR_URL`.

## Permit2 And EIP-2612 Sponsorship

The protected route sets `assetTransferMethod: "permit2"` and declares
`eip2612GasSponsoring`. With normal Permit2 payments, a user may first need to
approve the Permit2 contract to spend the ERC-20 token. If the token supports
EIP-2612 `permit()`, the x402 client can sign that approval off-chain when
Permit2 allowance is missing.

The payment payload then carries the permit data. During settlement, the
facilitator submits permit plus payment settlement in one sponsored transaction,
so the user does not need to send a separate gas-paid approval transaction for
the first Permit2 payment.

Important boundary:

- `Permit2` is the asset transfer method.
- EIP-2612 `permit()` is the token-level off-chain approval mechanism.
- The gas sponsorship extension combines them for lower-friction onboarding.

## Relevant Files

- `src/components/X402Demo.tsx`
- `src/app/api/protected/route.ts`
- `src/app/api/x402/facilitator/[action]/route.ts`
- `src/lib/x402-config.ts`
- `src/lib/x402-browser-signer.ts`
- `src/lib/x402-facilitator.ts`
- `src/lib/x402-resource-facilitator-client.ts`
