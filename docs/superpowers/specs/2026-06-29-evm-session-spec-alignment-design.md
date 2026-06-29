# EVM Session Spec Alignment Design

Date: 2026-06-29

## Goal

Align the payment-demo EVM session flows with `tempoxyz/mpp-specs#225`
for the parts this repo actually demonstrates:

- client-funded session open/top-up via `open` / `topUp`
- server-funded Permit2 session open/top-up via `openWithPermit2` /
  `topUpWithPermit2`
- voucher submission and server close
- `Payment-Receipt` generation and browser receipt parsing

The repo should not implement every optional feature in the full spec just
because it exists. Optional or unused features stay out of scope unless the
demo already exposes them or the change is required to make an exposed path
spec-compatible.

Reference baseline:

- PR: https://github.com/tempoxyz/mpp-specs/pull/225
- Head SHA used for this design: `c78f77ff183a8f909e7140bfc90a3cdb860ede5f`
- Spec file: `specs/methods/evm/draft-evm-session-00.md`

## Scope Boundary

### In scope

1. Rename the on-wire session method from `tempo.session` to `evm.session`.
2. Use the EVM voucher EIP-712 domain name, `"EVM Payment Channel"`.
3. Update the used credential payload shapes:
   - client-broadcast open/top-up: `type: "hash"` and `hash`
   - Permit2 open/top-up: top-level `type: "permit2"` with nested
     `authorization` and separate `voucherSignature`
4. Update the contract and TS ABI for the relayed Permit2 functions used by
   `/api/mpp/session-gasless`.
5. Update the existing EIP-3009 functions in `TempoStreamChannelEvm.sol` to
   the spec names and nonce binding shape because the contract currently
   exposes and documents them.
6. Update request `methodDetails` negotiation for the two demonstrated routes:
   - `/api/mpp/session`: `feePayer: false`, `credentialTypes: ["hash"]`
   - `/api/mpp/session-gasless`: `feePayer: true`,
     `credentialTypes: ["permit2"]`, `permit2Contract`
7. Add server-side checks for client-submitted transaction hashes used by the
   official-style route.
8. Return spec-shaped receipts with `method: "evm"`, `chainId`, and
   `reference === channelId`.
9. Keep finalized channel records instead of deleting their contents on close
   or withdraw.
10. Update docs, tests, and UI labels that describe the session method or
    payload fields.

### Out of scope

These are in the full spec but not demonstrated by the current repo:

- EIP-3009 browser/client flow and route support. The contract functions are
  kept spec-shaped because they already exist, but the app will not advertise
  `"authorization"` in `credentialTypes` until a client path exists.
- Payee-relayed `settleWithAuthorization` and `closeWithAuthorization`.
- Standalone `settle` route or scheduled settlement. Final settlement remains
  through `close`.
- UI/API for `requestClose` and `withdraw`. Contract functions remain because
  they are mandatory core, but the demo does not expose a payer escape UI.
- Voucher `deposit` merge mode.
- `HEAD` voucher-only updates.
- SSE final `payment-receipt` events and HTTP trailers.
- Splits. The current fetched spec body does not define a concrete splits
  section, and the demo has no split-payee model.
- ERC-1271 voucher signers. The demo uses connected EOA wallets; contract
  wallet support can be added later as a separate feature.
- ERC-4337 EntryPoint-mediated hash verification. The official demo currently
  submits direct wallet contract calls, so server hash verification will accept
  direct escrow calls only.

## Current State Summary

The repo currently implements an internally consistent MegaETH session demo,
but it is based on the Tempo session method:

- API routes use `Methods.session` from `mppx/tempo`.
- Browser clients reject non-`tempo` session challenges.
- Voucher signing and recovery use the `"Tempo Stream Channel"` EIP-712 domain.
- Official open/top-up credentials use `type: "transaction"` and `txHash`.
- Gasless Permit2 credentials flatten `permit2Nonce`, `permit2Deadline`, and
  `permit2Signature` directly onto the payload.
- Receipts return `method: "tempo"` and omit required `chainId`.
- `TempoStreamChannelEvm` exposes non-spec relayed function names and parameter
  order.

The design below changes only the exposed demo surface to match the EVM session
spec.

## Target Architecture

### Method Definition

Add a local EVM session method helper instead of relying on
`mppx/tempo`'s `Methods.session` values.

New module:

- `src/lib/mpp-evm-session-method.ts`

Responsibilities:

- Export `EVM_SESSION_METHOD_NAME = "evm"`.
- Export `EVM_SESSION_INTENT = "session"`.
- Export a `Method.from(...)` method instance with:
  - `name: "evm"`
  - `intent: "session"`
  - relaxed credential payload schema for this demo's custom actions
  - request schema covering the fields this repo emits and consumes

The request schema should model the spec-shaped challenge:

- `amount`: base-unit decimal string
- `unitType`: optional string
- `suggestedDeposit`: optional base-unit decimal string
- `currency`: address string
- `recipient`: address string
- `methodDetails.chainId`: number
- `methodDetails.escrowContract`: address string
- `methodDetails.feePayer`: boolean
- `methodDetails.credentialTypes`: string array
- `methodDetails.permit2Contract`: optional address string

The existing human-readable env vars remain:

- `NEXT_PUBLIC_MPP_SESSION_REQUEST_AMOUNT`
- `MPP_SESSION_REQUEST_AMOUNT`
- `NEXT_PUBLIC_MPP_SESSION_DEPOSIT_AMOUNT`
- `MPP_SESSION_DEPOSIT_AMOUNT`

`mpp-session-config.ts` should export base-unit strings derived with
`parseUnits(..., MPP_SESSION_TOKEN_DECIMALS)` for challenge defaults. The UI can
continue to display the human strings.

### Route Defaults

`src/app/api/mpp/session/route.ts` should advertise the client-funded hash path:

```ts
defaults: {
  amount: MPP_SESSION_REQUEST_AMOUNT_BASE_UNITS,
  chainId: megaethTestnet.id,
  currency: MPP_SESSION_TOKEN_ADDRESS,
  escrowContract: MPP_SESSION_ESCROW_CONTRACT,
  recipient,
  suggestedDeposit: MPP_SESSION_DEPOSIT_AMOUNT_BASE_UNITS,
  unitType: "request",
  methodDetails: {
    chainId: megaethTestnet.id,
    credentialTypes: ["hash"],
    escrowContract: MPP_SESSION_ESCROW_CONTRACT,
    feePayer: false,
  },
}
```

`src/app/api/mpp/session-gasless/route.ts` should advertise only the Permit2
server-funded path that the demo actually implements:

```ts
defaults: {
  amount: MPP_SESSION_REQUEST_AMOUNT_BASE_UNITS,
  chainId: megaethTestnet.id,
  currency: MPP_SESSION_TOKEN_ADDRESS,
  escrowContract: MPP_SESSION_ESCROW_CONTRACT,
  recipient,
  suggestedDeposit: MPP_SESSION_DEPOSIT_AMOUNT_BASE_UNITS,
  unitType: "request",
  methodDetails: {
    chainId: megaethTestnet.id,
    credentialTypes: ["permit2"],
    escrowContract: MPP_SESSION_ESCROW_CONTRACT,
    feePayer: true,
    permit2Contract: PERMIT2_ADDRESS,
  },
}
```

The final `WWW-Authenticate` challenge is the compatibility contract. Tests
should assert the decoded challenge request has the spec-shaped
`methodDetails` above, regardless of how the local `Method.from(...)` helper
has to provide defaults internally.

### Contract Alignment

`contract/src/TempoStreamChannel.sol`:

- Change the voucher EIP-712 domain name from `"Tempo Stream Channel"` to
  `"EVM Payment Channel"`.
- Replace `_clearAndFinalize` with a finalization helper that does not delete
  the channel record.
- On `close`, set `channel.settled` to the final settled amount, set
  `channel.finalized = true`, clear or leave `closeRequestedAt` consistently,
  and keep `payer`, `payee`, `token`, `authorizedSigner`, and `deposit`.
- On `withdraw`, keep the same record fields and set `finalized = true`.

`contract/src/TempoStreamChannelEvm.sol`:

- Replace `openWithReceiveAuthorization` with the spec-shaped
  `openWithAuthorization` ABI, including the caller-supplied EIP-3009
  `nonce` argument in the exact spec order:

```solidity
function openWithAuthorization(
    address payee,
    address token,
    uint128 deposit,
    bytes32 salt,
    address authorizedSigner,
    address from,
    uint256 validAfter,
    uint256 validBefore,
    bytes32 nonce,
    bytes calldata signature
) external returns (bytes32 channelId);
```

The implementation must recompute
`keccak256(abi.encode(from, payee, token, salt, authorizedSigner))` and revert
with a dedicated nonce mismatch error before calling `receiveWithAuthorization`
if the supplied `nonce` differs. `from` is the channel payer and the EIP-3009
`from`; it replaces the current `payer` argument.

- Replace `topUpWithReceiveAuthorization` with the spec-shaped
  `topUpWithAuthorization` ABI, including both `from` and `topUpSalt` before
  the EIP-3009 validity window:

```solidity
function topUpWithAuthorization(
    bytes32 channelId,
    uint128 additionalDeposit,
    address from,
    bytes32 topUpSalt,
    uint256 validAfter,
    uint256 validBefore,
    bytes32 nonce,
    bytes calldata signature
) external;
```

The implementation must require `from == channel.payer`, recompute
`keccak256(abi.encode(channelId, additionalDeposit, from, topUpSalt))`, and
revert with the same nonce mismatch error before calling
`receiveWithAuthorization` if the supplied `nonce` differs.
- Change `openWithPermit2` signature to:

```solidity
function openWithPermit2(
    address payee,
    address token,
    uint128 deposit,
    bytes32 salt,
    address authorizedSigner,
    address from,
    uint256 nonce,
    uint256 deadline,
    bytes calldata signature
) external returns (bytes32 channelId);
```

- Change `topUpWithPermit2` signature to:

```solidity
function topUpWithPermit2(
    bytes32 channelId,
    uint128 additionalDeposit,
    address from,
    uint256 nonce,
    uint256 deadline,
    bytes calldata signature
) external;
```

- Rename witness types from `OpenChannelWitness` / `TopUpWitness` to
  `ChannelOpenWitness` / `ChannelTopUpWitness` in both type hashes and type
  strings.

The existing Permit2 behavior remains otherwise the same: the escrow uses
`permitWitnessTransferFrom`, sends tokens to `address(this)`, and reconstructs
the witness from function arguments.

### TS ABI And Typed Data

`src/lib/megaeth-session.ts` should become the single source for the aligned
contract surface:

- Update `megaethSessionEscrowAbi` with the new `openWithPermit2` and
  `topUpWithPermit2` signatures.
- Add `openWithAuthorization` and `topUpWithAuthorization` ABI entries for the
  exposed contract surface. Do not wire them into routes or advertise
  `"authorization"` yet.
- Change voucher signing and verification domain name to
  `"EVM Payment Channel"`.
- Rename Permit2 witness typed-data definitions to
  `ChannelOpenWitness` and `ChannelTopUpWitness`.
- Keep `from` in the route payload's `authorization` object, not in the Permit2
  typed-data fields. Permit2 receives the owner as the `from` argument during
  signature verification; it is not a field in `PermitWitnessTransferFrom`.

The Permit2 EIP-712 typed data remains:

- domain `name: "Permit2"`
- domain `verifyingContract: PERMIT2_ADDRESS`
- primary type `PermitWitnessTransferFrom`
- signed `spender` equal to the escrow contract

### Official Client-Broadcast Flow

`src/lib/mpp-official-session-browser-client.ts`:

- Parse `challenge.method === "evm"` and `challenge.intent === "session"`.
- Use `challenge.request.amount` and `suggestedDeposit` as base-unit strings.
- Keep the UI `configuredDepositHuman` input for local planning, but compare it
  to base-unit challenge values.
- For open payload:

```ts
payload: {
  action: "open",
  authorizedSigner: account,
  channelId,
  cumulativeAmount: plan.nextCumulativeAmount.toString(),
  hash: openHash,
  salt,
  signature,
  type: "hash",
}
```

- Do not include `payer`, `token`, `deposit`, or `txHash` in the credential
  payload unless a local helper needs them for display. The server should derive
  payer from `source`, token from `request.currency`, and deposit from chain
  state.
- For top-up payload:

```ts
payload: {
  action: "topUp",
  additionalDeposit: additionalDeposit.toString(),
  channelId: state.channelId,
  hash: topUpHash,
  type: "hash",
}
```

- Close and voucher payloads already roughly match the spec; they need only the
  new method and voucher domain.

`src/app/api/mpp/session/route.ts`:

- Require `payload.type === "hash"` for open/top-up.
- Read transaction by `payload.hash`.
- Verify receipt status is `success`.
- Verify direct transaction target is `escrowContract`.
- Decode input and require:
  - open: `functionName === "open"`, args match recipient, currency, salt, and
    authorized signer
  - topUp: `functionName === "topUp"`, args match channelId and
    additionalDeposit
- Query on-chain channel state after receipt verification.
- For top-up, require `onChain.deposit === existing.deposit + additionalDeposit`.

ERC-4337 hash verification remains out of scope. If a hash targets anything
other than the escrow directly, the route rejects it with a clear verification
error.

### Gasless Permit2 Flow

`src/lib/mpp-session-browser-client.ts`:

- Parse `challenge.method === "evm"`.
- Require `methodDetails.feePayer === true` and
  `credentialTypes.includes("permit2")`.
- Build the Permit2 authorization object exactly as the spec describes.
- For open payload:

```ts
payload: {
  action: "open",
  authorization: {
    from: account,
    permitted: {
      amount: plan.depositAmount.toString(),
      token: currency,
    },
    nonce: permit2Nonce.toString(),
    deadline: permit2Deadline.toString(),
    witness: {
      payee: recipient,
      salt,
      authorizedSigner: account,
    },
  },
  authorizedSigner: account,
  channelId,
  cumulativeAmount: plan.nextCumulativeAmount.toString(),
  salt,
  signature: permit2Signature,
  type: "permit2",
  voucherSignature,
}
```

- For top-up payload:

```ts
payload: {
  action: "topUp",
  additionalDeposit: additionalDeposit.toString(),
  authorization: {
    from: account,
    permitted: {
      amount: additionalDeposit.toString(),
      token: currency,
    },
    nonce: permit2Nonce.toString(),
    deadline: permit2Deadline.toString(),
    witness: {
      channelId: state.channelId,
    },
  },
  channelId: state.channelId,
  signature: permit2Signature,
  type: "permit2",
}
```

`src/app/api/mpp/session-gasless/route.ts`:

- Require `payload.type === "permit2"` for open/top-up.
- Validate `authorization.from` equals the payer.
- Validate `authorization.permitted.token === request.currency`.
- Validate `authorization.permitted.amount` equals the top-level deposit or
  additional deposit.
- Validate `authorization.witness` exactly matches the authoritative channel
  parameters.
- Verify Permit2 recovery against `authorization.from`.
- Call the new contract signatures:
  - `openWithPermit2(payee, token, deposit, salt, authorizedSigner, from, nonce, deadline, signature)`
  - `topUpWithPermit2(channelId, additionalDeposit, from, nonce, deadline, signature)`
- Verify post-transaction channel state.

The gasless route may keep the existing optional permit20 approval helper as a
demo convenience before Permit2 `SignatureTransfer`. That helper is outside
PR #225's EVM session credential shape, so it should remain a local extension
field and should not be advertised as an EVM session credential type.

### Voucher Acceptance

Both session routes should verify voucher signatures before any stale or
idempotency decision:

1. Load the channel state.
2. Query on-chain state and ensure it is open with no pending close request.
3. Verify the voucher signature with the EVM domain.
4. If `cumulativeAmount <= existing.highestVoucherAmount`, return a success
   receipt without changing state.
5. For this demo's one-request-per-unit business model, require
   `cumulativeAmount === existing.highestVoucherAmount + requestAmount` for a
   new paid request.
6. Require `cumulativeAmount <= onChain.deposit`.
7. Persist the new highest voucher with compare-and-swap before returning paid
   content.

This keeps the demo's fixed one-unit billing model while following the spec's
ordering requirement: stale vouchers are only treated as idempotent after they
are proven to be valid vouchers for the channel.

### Close Flow

Close remains server-submitted and server-funded.

Changes:

- Verify the close voucher with the EVM domain.
- Keep requiring `cumulativeAmount === existing.highestVoucherAmount` because
  the demo exposes close as "settle exactly what the server has accepted".
- Call `close(channelId, cumulativeAmount, signature)`.
- Verify the finalized on-chain record without expecting channel fields to be
  deleted.
- Remove the server-side channel from Redis/memory after successful close.

The server-side store deletion is local accounting cleanup. It does not conflict
with the spec's on-chain record retention requirement.

### Receipt Shape

All successful session receipts should include:

```json
{
  "method": "evm",
  "intent": "session",
  "status": "success",
  "timestamp": "2026-04-01T12:08:30Z",
  "reference": "0x...",
  "challengeId": "...",
  "channelId": "0x...",
  "acceptedCumulative": "250000",
  "spent": "250000",
  "chainId": 6343,
  "units": 1
}
```

Rules:

- `reference` is always `channelId`.
- `chainId` is always included.
- `txHash` remains optional and may be included for open, top-up, and close in
  this demo because the UI displays explorer links. The spec explicitly makes
  it optional method-specific evidence.
- `permit20TxHash` may remain a local extension field on gasless receipts when
  the server sponsors a Permit2 approval. It is not part of the EVM session
  core receipt.

Browser receipt parsers should accept the full receipt but expose the same UI
fields they already show, plus `method`, `reference`, and `chainId` where useful.

### State Store

The Redis/memory store remains a server accounting cache, not the source of
truth for channel existence.

Changes:

- Store `chainId`, `escrowContract`, `channelId`, payer/payee/token,
  highest accepted voucher, on-chain deposit, and units as today.
- Continue compare-and-swap updates by `highestVoucherAmount`.
- Do not add a durable replay table for every voucher signature in this pass.
  Exact stale vouchers are handled by verifying the signature and returning the
  current receipt without state mutation.

### Tests

Contract-facing tests should cover:

- `TempoStreamChannelEvm` inherits the shared core contract.
- Voucher domain name is `"EVM Payment Channel"`.
- `_clearAndFinalize` no longer deletes the channel record.
- ABI exposes spec-shaped `openWithPermit2` and `topUpWithPermit2`.
- ABI exposes `openWithAuthorization` and `topUpWithAuthorization` if the
  contract keeps EIP-3009 support.
- Permit2 witness type strings use `ChannelOpenWitness` and
  `ChannelTopUpWitness`.

TS tests should cover:

- EVM session method emits/parses `method: "evm"`, not `"tempo"`.
- Official open credential uses `type: "hash"` and `hash`.
- Gasless open credential uses nested `authorization` and `voucherSignature`.
- Receipt parser keeps `reference === channelId` and reads `chainId`.
- Voucher verification uses the EVM domain.
- Stale but valid voucher returns success without advancing state.
- Invalid stale voucher is rejected before idempotency.
- Official top-up requires exact deposit increase.

Existing tests that assert old ABI shapes or old method names should be updated,
not duplicated.

### Docs And UI Copy

Update:

- `docs/mpp-session-current-scheme.md`
- `README.md`
- `.env.example` comments if they mention `tempo.session`
- `src/components/MppOfficialSessionDemo.tsx`
- `src/components/MppSessionGaslessDemo.tsx`

Copy should describe the session demo as EVM session:

- "EVM session: client pays gas" for `/api/mpp/session`
- "EVM session: Permit2 gasless" for `/api/mpp/session-gasless`

Keep MPP charge docs unchanged unless they mention the session route by old
name.

## Migration Notes

Changing the EIP-712 domain and contract function signatures requires a new
escrow deployment. Existing channels opened against the current deployed
`NEXT_PUBLIC_MPP_SESSION_ESCROW` cannot be migrated in-place because their
voucher domain and ABI are different.

After deployment:

1. Update `NEXT_PUBLIC_MPP_SESSION_ESCROW` and `MPP_SESSION_ESCROW`.
2. Clear or namespace the server session state store because old stored
   channels refer to the old escrow and old voucher domain.
3. Refresh browser local component state by closing/reloading the demo page.

## Implementation Order

1. Add the local EVM session method helper and base-unit config exports.
2. Update contract domain, finalization, and relayed function signatures.
3. Update `megaeth-session.ts` ABI, typed data, and tests.
4. Update official route and browser client payloads.
5. Update gasless route and browser client payloads.
6. Update receipts and receipt parsers.
7. Update voucher idempotency ordering.
8. Update docs/UI copy.
9. Run focused Node tests, Foundry build/tests if available, `pnpm lint`, and
   `pnpm build`.

## Self-Review

- Scope is limited to code paths currently demonstrated or currently exposed by
  the repo's contract.
- Unused optional spec features are explicitly out of scope.
- The design requires a new escrow deployment because voucher domain and ABI
  changes are not backward compatible.
- The receipt, credential, method, and contract surfaces all use the PR #225 EVM
  session names.
