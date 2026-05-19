# MPP Session Current Scheme

Date: 2026-05-19

## Goal

This document summarizes the current MPP `tempo.session` pay-as-you-go scheme:

- The official session lifecycle and client/server responsibilities.
- The main MegaETH / EVM changes compared with the official default model.
- The core method differences between `TempoStreamChannelEvm.sol` and `TempoStreamChannel.sol`.

References:

- [MPP pay-as-you-go guide](https://mpp.dev/guides/pay-as-you-go.md)
- [Tempo session payment method](https://mpp.dev/payment-methods/tempo/session.md)
- [Tempo session specification](https://paymentauth.org/draft-tempo-session-00)

## Official Pay-As-You-Go Scheme

The official `session` intent uses a unidirectional payment channel for high-frequency usage billing. The client first deposits tokens into an on-chain escrow. Later requests only require off-chain EIP-712 vouchers. The server verifies each voucher, serves the request, and settles or closes the channel on-chain when needed.

Key points:

- `open`, `top-up`, and `close` are on-chain lifecycle operations.
- Per-request vouchers are off-chain signatures and do not require an on-chain transaction.
- Vouchers use a cumulative `cumulativeAmount`; the server bills the delta between the new cumulative amount and the previous accepted cumulative amount.
- Channels are reusable across requests and do not need to be closed after each request.
- On close, the highest accepted voucher settles the payee balance and refunds unused deposit to the payer.

### Lifecycle

| Phase | Initiator | Description |
| --- | --- | --- |
| Challenge | Server | Protected endpoint returns `402 Payment Required` with price, currency, recipient, and session method. |
| Open | Client | First paid request deposits into escrow, creates `channelId`, and sends an open credential. |
| Voucher | Client | Each paid request signs a higher `cumulativeAmount` voucher. |
| Verify | Server | Verifies signature, increasing amount, and deposit coverage, then returns response plus receipt. |
| Top-up | Client | Adds deposit to the same channel when balance is low. |
| Settle | Server | Optionally calls `settle` with the highest voucher to withdraw consumed funds to the payee. |
| Close | Server, usually client-initiated | Calls `close` with the highest voucher, settles the payee, and refunds remaining deposit to the payer. |

### Method Responsibilities

| Method | Client responsibility | Server responsibility |
| --- | --- | --- |
| `open` | Deposit tokens, create channel, sign open credential and first voucher. | Verify channel/deposit and store the highest voucher. |
| `voucher` | Sign a higher cumulative amount per paid request. | Verify signature, monotonic amount, and remaining balance. |
| `top-up` | Add more deposit to the channel. | Verify the updated channel state. |
| `settle` | No regular responsibility. | Withdraw consumed funds with the highest accepted voucher. |
| `close` | Initiate close and provide the highest voucher. | Call escrow `close`, settle funds, and refund unused balance. |

## Current MegaETH / EVM Version

The current demo keeps the official session abstraction, but moves on-chain lifecycle transactions to a server relayer:

- The client signs only; it does not directly submit `open`, `top-up`, or `close` transactions.
- The server verifies MPP credentials and pays gas for escrow transactions.
- The escrow contract is `TempoStreamChannelEvm`, which adds Permit2 and EIP-3009 funding paths.
- The server stores the highest accepted voucher per channel in memory or Upstash Redis.

Relevant files:

- `src/app/api/mpp/session/route.ts`
- `src/lib/mpp-session-browser-client.ts`
- `src/lib/megaeth-session.ts`
- `src/lib/mpp-session-store.ts`
- `contract/src/TempoStreamChannel.sol`
- `contract/src/TempoStreamChannelEvm.sol`

### Current Flow

| Phase | Current implementation |
| --- | --- |
| Open | Client signs permit20 approval, Permit2 witness, and first voucher; server sponsors permit if needed and calls `openWithPermit2`. |
| Voucher | Client signs voucher; server checks store and on-chain channel, then updates highest voucher. |
| Top-up | Explicit UI action; client signs Permit2 top-up witness; server calls `topUpWithPermit2`. |
| Settle | Supported by the contract, but not wired into the current route. |
| Close | Client signs the highest cumulative voucher; server requires it to match stored highest value, then calls `close`. |
| Escape | Contract keeps `requestClose` / `withdraw`, but current UI/API does not expose them. |

Main differences from the official default model:

| Area | Official default model | Current EVM demo |
| --- | --- | --- |
| `open` / `top-up` / `close` transaction sender | Usually client. | Server relayer. |
| Client interaction | Wallet transaction plus voucher signing. | Permit / Permit2 / voucher signing only. |
| Funding | Tempo TIP-20 deposit. | ERC-20 plus Permit2 witness; EIP-3009 is also available in the contract. |
| Voucher hot path | Intended to be CPU-only signature verification. | Also reads store and on-chain channel for conservative validation. |
| `settle` | Server may settle periodically. | Not implemented yet; final settlement happens during `close`. |

## Contract Diff Overview

`TempoStreamChannel.sol` is the base unidirectional channel. The payer opens and tops up directly with approve plus `transferFrom`. `TempoStreamChannelEvm.sol` keeps the same channel semantics and adds gasless funding entry points so a server relayer can submit open/top-up transactions for the payer.

| Method | Base `TempoStreamChannel` | EVM version changes | Current route usage |
| --- | --- | --- | --- |
| `open` | `payer = msg.sender`; pulls deposit with `transferFrom`. | Keeps legacy `open`. Adds `openWithPermit2` and `openWithReceiveAuthorization`; explicit `payer` allows relayers. | Uses `openWithPermit2`. |
| `topUp` | Only payer can call; increases deposit and cancels pending close. | Keeps legacy `topUp`. Adds `topUpWithPermit2` and `topUpWithReceiveAuthorization`. | Uses `topUpWithPermit2`. |
| `settle` | Payee withdraws `cumulative - settled` using an increasing voucher. | Same semantics. | Not wired yet. |
| `close` | Payee closes with final voucher; payee gets delta, payer gets refund. | Same semantics. | Server relayer calls it; amount must match stored highest voucher. |
| `requestClose` / `withdraw` | Payer-side grace-period exit path. | Same semantics. | Not exposed in UI/API; contract-level fallback only. |

Key safety bindings in the EVM version:

- `openWithPermit2`: Permit2 witness binds `payee/salt/authorizedSigner`; token and amount are bound by `TokenPermissions`.
- `topUpWithPermit2`: Permit2 witness binds `channelId`, so a top-up signature cannot be reused for another channel.
- `openWithReceiveAuthorization`: EIP-3009 nonce binds `payee/salt/authorizedSigner`.
- `topUpWithReceiveAuthorization`: EIP-3009 nonce uses `keccak256(channelId, topUpNonceSalt)`, allowing multiple top-ups on the same channel.

## Follow-Ups

- Add periodic `settle` to reduce payee settlement risk on long-lived channels.
- Optimize the voucher hot path to avoid per-request chain reads.
- Add Redis CAS / Lua to avoid concurrent voucher state races on the same channel.
- Document or expose `requestClose` / `withdraw` as the payer fallback path.
- Auto top-up when balance is low instead of requiring a manual UI action.
