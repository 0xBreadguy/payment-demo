# MPP Charge Demo — Design

Date: 2026-05-13

## Goal

Add an MPP `tempo.charge` payment panel to the mega-payment-demo, parallel to the existing x402 panel. User clicks a button, the connected wallet sends a plain ERC20 `transfer` of 1 USDm on MegaETH testnet, the server verifies the transaction onchain via `mppx`, and returns protected content with a `Payment-Receipt` header.

The client pays its own gas (no facilitator sponsorship). Same USDm token as the x402 demo. Separate `MPP_PAY_TO` recipient with sensible fallbacks.

## Reference

Patterns adapted from `/Users/rubick/Desktop/project/mpp/src/`:

- `client/charge.ts` — challenge → ERC20 transfer → credential → re-fetch.
- `server/charge.ts` — `Mppx.create({ methods: [tempo.charge({...})] })` returning `withReceipt`.
- `smoke/charge.ts` — end-to-end smoke shape.

The reference uses a viem `PrivateKeyAccount` on the client. This demo uses the browser's connected wallet via wagmi, so the credential is built inline using `mppx` primitives (`Credential.serialize`, `Receipt.fromResponse`) rather than `Mppx.create` on the client.

## File layout

```
src/
  components/MppDemo.tsx              ← new browser panel (parallel to X402Demo)
  app/api/mpp/charge/route.ts         ← new Next.js route handler
  lib/mpp-config.ts                   ← env reading, payTo resolution, readiness flag
  lib/mpp-browser-client.ts           ← challenge → tx → credential helper (browser)
  app/page.tsx                        ← add <MppDemo /> alongside <X402Demo />
package.json                          ← add `mppx` dep
```

`.env.example` exists in the repo and has an `# --- x402 ---` section. New `# --- mpp ---` block appended with the new vars below. README updated to mention MPP env vars.

## Server route — `src/app/api/mpp/charge/route.ts`

Mirrors the existing `/api/protected` shape: a single `GET` handler guarded by `mppx`.

Key behavior:

- Build `Mppx.create({ methods: [tempo.charge({...})], realm, secretKey })` once at module scope.
- Charge method config:
  - `amount`: `MPP_CHARGE_AMOUNT` env (default `"1"`).
  - `chainId`: `6343` (MegaETH testnet, from `megaethTestnet.id`).
  - `currency`: `USDM_ADDRESS` (reuse existing constant).
  - `decimals`: `18`.
  - `description`: `"Pay 1 USDm via MPP to view the protected content"`.
  - `getClient`: returns a viem public client for MegaETH (server-side, uses `MEGAETH_RPC_URL` env or default).
  - `recipient`: resolved by `getMppPayToAddress()` (see config).
- `realm`: derived from request URL host (`new URL(req.url).host`).
- `secretKey`: `MPP_SECRET_KEY` env.
- Readiness: if `MPP_SECRET_KEY` is missing, return `503` with a JSON body listing the missing env vars (mirrors mpp reference `serverLiveReady` pattern).
- On 402: return the challenge response from `mppx` directly.
- On success: `result.withReceipt(NextResponse.json({ secret, when, quote }))` with the same shape as `/api/protected` but distinct copy so it's clearly the MPP route.

Because `Mppx.create` reads request state through closures, the module-scope instance is created lazily on first request (or inside the handler) to ensure env is available at request time on Vercel.

## Config — `src/lib/mpp-config.ts`

Exports:

- `MPP_CHARGE_AMOUNT_HUMAN` — string, default `"1"`. Passed to `tempo.charge`'s `amount` as the human-readable amount; `decimals: 18` lets `mppx` scale to wei. (The reference uses `"0.01"` strings the same way.)
- `MPP_CHARGE_AMOUNT_WEI` — `BigInt`, computed for browser-side `transfer` arg (`parseUnits(amount, 18)`).
- `getMppPayToAddress()` — resolution order:
  1. `MPP_PAY_TO` env
  2. `NEXT_PUBLIC_MPP_PAY_TO` env (for client-side reference if ever needed)
  3. `X402_PAY_TO` / `NEXT_PUBLIC_X402_PAY_TO` (reuse x402 destination)
  4. Server signer address from `SERVER_PRIVATE_KEY`
  5. Throws if none — surfaced as 503 missing env.
- `getMppSecretKey()` — reads `MPP_SECRET_KEY`.
- `getMppServerLiveReady()` — boolean + `missingEnv` array for 503 body.
- `MPP_PROTECTED_PATH = "/api/mpp/charge"` (for client).

## Browser flow — `src/lib/mpp-browser-client.ts`

Exports `payMppCharge({ walletClient, publicClient, account, targetUrl })` which:

1. `await fetch(targetUrl)` → expect 402; if anything else, throw with the response text for display.
2. Parse challenge via `Challenge.fromResponse(response)` (reads the `WWW-Authenticate` header). For multi-challenge servers use `Challenge.fromResponseList` and pick `method === 'tempo' && intent === 'charge'` — but this server only emits one challenge.
3. `writeContract` via wagmi's `walletClient` with `erc20Abi`, `transfer(challenge.request.recipient, BigInt(challenge.request.amount))`. `recipient` and `amount` (in wei) come from the challenge, not local config — server is authoritative.
4. `publicClient.waitForTransactionReceipt({ hash })` to make sure it's mined.
5. Build credential: `Credential.serialize({ challenge, payload: { hash, type: 'hash' }, source: 'did:pkh:eip155:6343:' + account.address })`.
6. `fetch(targetUrl, { headers: { Authorization: serialized } })`. `Credential.serialize` already returns the full `Payment <base64url>` header value, so it goes into the `Authorization` header verbatim.
7. If 200: `Receipt.fromResponse(response)` → return `{ status, body, receipt, txHash, explorerUrl }`.
8. If non-200: throw with body for display.

`explorerUrl` built from `megaethTestnet.blockExplorers.default.url + '/tx/' + txHash`.

## UI — `src/components/MppDemo.tsx`

Same layout language as `X402Demo.tsx`:

- Card with `mpp` badge, title `"Pay 1 USDm via MPP → Protected Content"`, subtitle `"Plain ERC20 transfer; client pays gas."`.
- Buttons: `"Preview 402 (no payment)"` and `"Pay 1 USDm via MPP & Fetch"`.
- States: `idle | loading(step) | success | error`. Steps shown live:
  - `"Requesting challenge…"`
  - `"Signing transfer in wallet…"`
  - `"Waiting for receipt…"`
  - `"Submitting credential…"`
- Success panel shows:
  - Protected content JSON
  - Tx hash + explorer link (`<a>` to MegaETH block explorer)
  - Receipt JSON (`reference`, `method`, `timestamp`)
- Error panel shows last message in red mono text.
- Disabled until `useAccount().isConnected` is true.
- "Preview 402" surfaces server readiness: a 402 means MPP is configured; a 503 displays the `missingEnv` list to guide setup. No separate health probe.

## Page wiring — `src/app/page.tsx`

Add a third row (or expand existing grid) with `<MppDemo />` alongside `<X402Demo />`. Update header copy to mention both x402 and MPP demos.

## Env vars (new)

| Var | Where | Purpose | Required? |
| --- | --- | --- | --- |
| `MPP_SECRET_KEY` | server | HMAC secret for `Mppx.create` challenge signing | Yes (else 503) |
| `MPP_PAY_TO` | server | Recipient of the 1 USDm transfer | No (falls back) |
| `MPP_CHARGE_AMOUNT` | server | Human-readable amount in USDm | No (default `"1"`) |
| `NEXT_PUBLIC_MPP_PAY_TO` | client | Optional client-visible recipient override | No |

Existing `NEXT_PUBLIC_USDM_ADDRESS`, `MEGAETH_RPC_URL`, `SERVER_PRIVATE_KEY` are reused.

## Error paths

| Condition | Behavior |
| --- | --- |
| Wallet not connected | Button disabled; error text on click attempt |
| Server `MPP_SECRET_KEY` missing | 503 from server; UI shows `missingEnv` list |
| User has no USDm | wagmi `writeContract` rejects (revert); UI shows error |
| User has no MegaETH ETH for gas | wagmi rejects; UI shows error |
| Tx mined but server rejects credential | non-200 on second fetch; UI shows server problem-detail JSON |
| `mppx` realm/secret mismatch | 401/403 from server; treated as generic error |

## Out of scope

- Gas sponsorship for MPP (kept simple per user request — client pays own gas).
- Session / streaming MPP modes (only `tempo.charge`).
- Smoke test scripts (no test infra in repo).
- E2E tests (no test infra in repo).
- `.env.example` (existing file; add `# --- mpp ---` block).

## Dependencies

- Add `mppx` (`^0.4.12`) to `package.json` dependencies. Install with `pnpm add mppx`.
- No new runtime deps beyond `mppx`. `viem` already present.

## Open considerations (resolved by user already)

- Token + recipient: reuse USDm token, separate `MPP_PAY_TO` env.
- Signer: browser wallet via wagmi; client pays gas.
