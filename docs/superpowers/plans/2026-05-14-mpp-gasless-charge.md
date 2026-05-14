# MPP Gasless Charge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parallel MPP gasless one-time payment flow where the browser signs an EIP-2612/permit20 authorization and the server pays gas to settle the token transfer.

**Architecture:** Keep the existing `tempo` MPP charge unchanged as the client-gas baseline. Add a custom `permit20` MPP charge method with a shared EIP-2612 typed-data helper, a Next route at `/api/mpp/gasless-charge`, a browser helper, and a separate UI panel.

**Tech Stack:** Next.js route handlers, React client components, `mppx` custom `Method`, `viem` typed-data signing/recovery and contract writes, Node test runner.

---

### Task 1: Shared Permit20 Method And Typed Data

**Files:**
- Create: `src/lib/mpp-permit20.ts`
- Test: `src/lib/mpp-permit20.test.mts`

- [x] Write a failing test proving `buildPermit20TypedData` and `recoverPermit20Signer` recover the EIP-2612 signer for the configured domain.
- [x] Run `node --test src/lib/mpp-permit20.test.mts` and verify it fails because the module does not exist.
- [x] Implement the custom `permit20ChargeMethod`, EIP-2612 ABI, typed-data builder, signer, and recovery helper.
- [x] Re-run `node --test src/lib/mpp-permit20.test.mts` and verify it passes.

### Task 2: Gasless Config And Server Route

**Files:**
- Create: `src/lib/mpp-gasless-config.ts`
- Create: `src/app/api/mpp/gasless-charge/route.ts`
- Modify: `.env.example`
- Modify: `README.md`

- [x] Add config for path, amount, token, token name/version, recipient, and readiness including `MPP_SECRET_KEY` and `SERVER_PRIVATE_KEY`.
- [x] Add a custom `Mppx.create` route using `Method.toServer(permit20ChargeMethod, ...)`.
- [x] In `verify`, validate signer/nonce/balance, submit `permit`, submit `transferFrom`, wait for receipts, and return a receipt referencing the transfer tx.
- [x] Document the env vars and gasless route.

### Task 3: Browser Helper And UI

**Files:**
- Create: `src/lib/mpp-gasless-browser-client.ts`
- Create: `src/components/MppGaslessDemo.tsx`
- Modify: `src/components/MppDemo.tsx`
- Modify: `src/app/page.tsx`

- [x] Add a browser helper that obtains the custom challenge, reads the token nonce, signs the permit typed data, submits the Credential, and parses the receipt.
- [x] Add a gasless UI panel with progress states and receipt/transaction output.
- [x] Rename/copy the plain MPP card copy to explicitly say “MPP charge: client pays gas”.
- [x] Render both MPP cards side by side on the page.

### Task 4: Verification

**Files:**
- All changed files.

- [x] Run focused tests for the new helper and existing tests touched by import changes.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build`.
- [x] If a local env is available, start `pnpm dev` and preview both MPP panels.
