# MPP Charge Current Scheme

Date: 2026-05-25

## Goal

This document summarizes the demo's MPP one-time charge flows:

- The `charge` intent lifecycle for fixed-price protected requests.
- The current push mode, where the client pays gas.
- The current pull / gasless mode, where the server sponsors settlement.

References:

- [MPP one-time payments guide](https://mpp.dev/guides/one-time-payments)
- [MPP charge intent](https://mpp.dev/intents/charge)
- [Tempo charge payment method](https://mpp.dev/payment-methods/tempo/charge)

## Charge Model

MPP `charge` is the one-time payment intent: one request, one fixed payment, one
receipt. It fits paid API calls, content unlocks, and fixed-price tool calls.
For high-frequency or usage-metered billing, use `session` instead.

The lifecycle is:

| Step | Description |
| --- | --- |
| Request | Client calls a protected route without payment. |
| Challenge | Server returns `402 Payment Required` with an MPP Challenge. |
| Pay / sign | Client satisfies the Challenge with the selected payment method. |
| Retry | Client retries the same route with an `Authorization` Credential. |
| Verify / settle | Server verifies the Credential and settles payment. |
| Receipt | Server returns protected content with a `Payment-Receipt`. |

The main request fields are `amount`, `currency`, `recipient`, optional
`description`, optional `expires`, and method-specific `methodDetails`.

## Push Mode

Push mode is the plain MPP charge path in this demo.

| Item | Value |
| --- | --- |
| UI | `MppDemo` |
| Route | `GET /api/mpp/charge` |
| Method | official `tempo.charge` |
| Asset | USDm from `NEXT_PUBLIC_USDM_ADDRESS` |
| Amount | `MPP_CHARGE_AMOUNT`, default `1` |
| Gas payer | Client wallet |

Flow:

1. Browser requests `/api/mpp/charge` and receives a `tempo.charge` Challenge.
2. Browser wallet sends a USDm `transfer(recipient, amount)` transaction.
3. Browser waits for the transaction receipt.
4. Browser submits an MPP Credential with `payload: { type: "hash", hash }`.
5. Server verifies the transaction and returns protected content with a receipt.

This matches the official Tempo charge pattern where the client broadcasts the
payment transaction and the server verifies the resulting transaction hash.

## Pull / Gasless Mode

Pull mode is implemented as a custom `permit20.charge` method for MegaETH USDm.
The user signs an EIP-2612 permit; the server pays gas to submit `permit` and
then pull funds with `transferFrom`.

| Item | Value |
| --- | --- |
| UI | `MppGaslessDemo` |
| Route | `GET /api/mpp/gasless-charge` |
| Method | custom `permit20.charge` |
| Asset | USDm from `NEXT_PUBLIC_USDM_ADDRESS` |
| Amount | `MPP_GASLESS_CHARGE_AMOUNT`, then `MPP_CHARGE_AMOUNT`, then `1` |
| Gas payer | Server signer from `SERVER_PRIVATE_KEY` |

Flow:

1. Browser requests `/api/mpp/gasless-charge` and receives a `permit20.charge`
   Challenge with `chainId`, `spender`, `tokenName`, and `tokenVersion`.
2. Browser reads the token nonce and signs EIP-2612
   `Permit(owner, spender, value, nonce, deadline)`.
3. Browser submits the permit payload as an MPP Credential.
4. Server verifies signer, nonce, deadline, amount, recipient, spender, and
   balance.
5. Server submits `permit`, then `transferFrom(owner, recipient, amount)`.
6. Server returns protected content and a receipt referencing the transfer hash.

The official Tempo docs describe pull mode as server-side transaction
broadcasting / fee sponsorship. This demo uses the same user-facing shape, but
with a custom EIP-2612 permit payload because the app is running on MegaETH with
an ERC-20-style USDm token.

## Relevant Files

- `src/components/MppDemo.tsx`
- `src/components/MppGaslessDemo.tsx`
- `src/app/api/mpp/charge/route.ts`
- `src/app/api/mpp/gasless-charge/route.ts`
- `src/lib/mpp-config.ts`
- `src/lib/mpp-browser-client.ts`
- `src/lib/mpp-gasless-config.ts`
- `src/lib/mpp-gasless-browser-client.ts`
- `src/lib/mpp-permit20.ts`
