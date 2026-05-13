# MPP Charge Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third payment panel to the mega-payment-demo that uses the MPP `tempo.charge` protocol — user clicks a button, browser wallet signs an ERC20 `transfer` of 1 USDm, server verifies the tx onchain via `mppx`, and returns protected content with a `Payment-Receipt` header.

**Architecture:** Mirrors the existing x402 demo's three-layer split: server route (`/api/mpp/charge`), client config (`lib/mpp-config.ts`), browser flow (`lib/mpp-browser-client.ts` + `components/MppDemo.tsx`). Uses `mppx` package on the server to issue 402 + verify, and `mppx`'s `Challenge.fromResponse` / `Credential.serialize` / `Receipt.fromResponse` primitives on the browser side. Client signs and pays gas via wagmi's wallet client (no facilitator sponsorship). USDm token shared with x402; payment recipient configured separately via `MPP_PAY_TO` with fallbacks.

**Tech Stack:** Next.js 16 App Router, mppx ^0.4.12, viem ^2.48.11, wagmi ^2.19.5, Tailwind v4.

**Reference:** Spec at `docs/superpowers/specs/2026-05-13-mpp-charge-design.md`.

---

## File Structure

**New files:**
- `src/lib/mpp-config.ts` — env reading, payTo resolution, readiness flag
- `src/lib/mpp-browser-client.ts` — browser challenge → tx → credential helper
- `src/components/MppDemo.tsx` — UI panel
- `src/app/api/mpp/charge/route.ts` — Next.js GET route handler

**Modified files:**
- `package.json` — add `mppx` dependency
- `src/app/page.tsx` — render `<MppDemo />` in the grid
- `.env.example` — append `# --- mpp ---` section
- `README.md` — document new env vars

---

## Task 1: Install mppx dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install package**

Run from repo root `/Users/rubick/Desktop/project/mega-payment-demo`:

```bash
pnpm add mppx@^0.4.12
```

Expected: `package.json` `dependencies` now includes `"mppx": "^0.4.12"`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify import resolves**

Run:

```bash
node --input-type=module -e "import('mppx').then(m => console.log(Object.keys(m).sort().join(','))); import('mppx/server').then(m => console.log(Object.keys(m).sort().join(','))); import('mppx/client').then(m => console.log(Object.keys(m).sort().join(',')))"
```

Expected output includes `Challenge,Credential,Receipt,...` from `mppx`, `Mppx,tempo,...` from `mppx/server`, and `Mppx,tempo,...` from `mppx/client`. Any module-not-found means install failed — re-run install.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add mppx dependency for MPP charge demo"
```

---

## Task 2: Create MPP config module

**Files:**
- Create: `src/lib/mpp-config.ts`

- [ ] **Step 1: Write the config module**

Create `src/lib/mpp-config.ts`:

```ts
import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDM_ADDRESS, USDM_DECIMALS } from "./usdm";

export const MPP_PROTECTED_PATH = "/api/mpp/charge";
export const MPP_CHARGE_AMOUNT_HUMAN =
  process.env.MPP_CHARGE_AMOUNT ?? "1";
export const MPP_TOKEN_ADDRESS: Address = USDM_ADDRESS;
export const MPP_TOKEN_DECIMALS = USDM_DECIMALS;

export type MppReadiness = {
  ready: boolean;
  missingEnv: string[];
};

export function getMppSecretKey(): string | undefined {
  return process.env.MPP_SECRET_KEY;
}

export function getMppPayToAddress(): Address | null {
  const candidates = [
    process.env.MPP_PAY_TO,
    process.env.NEXT_PUBLIC_MPP_PAY_TO,
    process.env.X402_PAY_TO,
    process.env.NEXT_PUBLIC_X402_PAY_TO,
  ];
  for (const candidate of candidates) {
    if (candidate) return getAddress(candidate);
  }
  const pk = process.env.SERVER_PRIVATE_KEY;
  if (pk) {
    const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
    return privateKeyToAccount(normalized).address;
  }
  return null;
}

export function getMppReadiness(): MppReadiness {
  const missingEnv: string[] = [];
  if (!getMppSecretKey()) missingEnv.push("MPP_SECRET_KEY");
  if (!getMppPayToAddress())
    missingEnv.push("MPP_PAY_TO (or X402_PAY_TO, or SERVER_PRIVATE_KEY)");
  return { ready: missingEnv.length === 0, missingEnv };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. If errors mention missing `viem/accounts` or `./usdm`, double-check the imports against existing `src/lib/x402-facilitator.ts` and `src/lib/usdm.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mpp-config.ts
git commit -m "feat: add MPP config module with env + payTo resolution"
```

---

## Task 3: Create MPP server route handler

**Files:**
- Create: `src/app/api/mpp/charge/route.ts`

The handler:
1. Returns 503 if `MPP_SECRET_KEY` or `MPP_PAY_TO` (with fallbacks) are missing.
2. On `GET` with no `Authorization`, returns the 402 with `WWW-Authenticate` challenge.
3. On `GET` with a valid `Authorization`, verifies the tx onchain and returns content + `Payment-Receipt`.

`Mppx.create` is built lazily on first request so Next.js can pick up runtime env on Vercel.

- [ ] **Step 1: Write the route**

Create `src/app/api/mpp/charge/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { Mppx, tempo } from "mppx/server";
import { megaethTestnet } from "@/lib/chain";
import {
  MPP_CHARGE_AMOUNT_HUMAN,
  MPP_TOKEN_ADDRESS,
  MPP_TOKEN_DECIMALS,
  getMppPayToAddress,
  getMppReadiness,
  getMppSecretKey,
} from "@/lib/mpp-config";

type MppxHandler = ReturnType<typeof Mppx.create>;

let cached: MppxHandler | null = null;
let cachedRealm: string | null = null;

function getMppx(realm: string): MppxHandler {
  if (cached && cachedRealm === realm) return cached;
  const secretKey = getMppSecretKey();
  const recipient = getMppPayToAddress();
  if (!secretKey || !recipient) {
    throw new Error("MPP not configured");
  }
  const rpcUrl =
    process.env.MEGAETH_RPC_URL ?? "https://carrot.megaeth.com/rpc";

  cached = Mppx.create({
    methods: [
      tempo.charge({
        amount: MPP_CHARGE_AMOUNT_HUMAN,
        chainId: megaethTestnet.id,
        currency: MPP_TOKEN_ADDRESS,
        decimals: MPP_TOKEN_DECIMALS,
        description: "Pay 1 USDm via MPP to view the protected content",
        getClient: () =>
          createPublicClient({
            chain: megaethTestnet,
            transport: http(rpcUrl),
          }),
        recipient,
      }),
    ],
    realm,
    secretKey,
  });
  cachedRealm = realm;
  return cached;
}

export async function GET(request: NextRequest): Promise<Response> {
  const readiness = getMppReadiness();
  if (!readiness.ready) {
    return NextResponse.json(
      {
        error: "MPP charge route is not configured yet.",
        missingEnv: readiness.missingEnv,
      },
      { status: 503 },
    );
  }

  const realm = new URL(request.url).host;
  const mppx = getMppx(realm);
  const result = await mppx.tempo.charge({})(request);

  if (result.status === 402) {
    return result.challenge;
  }

  return result.withReceipt(
    NextResponse.json({
      ok: true,
      route: "mpp/charge",
      secret: "🎉 You paid 1 USDm via MPP. Here is the protected content.",
      when: new Date().toISOString(),
      quote: "Payment is a protocol. Settle, verify, deliver.",
    }),
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. If errors complain about `MppxHandler`'s return-type, replace `type MppxHandler = ReturnType<typeof Mppx.create>;` with `type MppxHandler = ReturnType<typeof Mppx.create<readonly [ReturnType<typeof tempo.charge>]>>;` — `mppx` keeps strict generics.

- [ ] **Step 3: Smoke 503 path locally**

Make sure `MPP_SECRET_KEY` is NOT in `.env.local`. Run:

```bash
pnpm dev
```

In another terminal:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/mpp/charge
```

Expected: `503`.

```bash
curl -s http://localhost:3000/api/mpp/charge | jq
```

Expected JSON: `{ "error": "MPP charge route is not configured yet.", "missingEnv": ["MPP_SECRET_KEY", "MPP_PAY_TO ..."] }`. Stop the dev server (Ctrl+C).

- [ ] **Step 4: Smoke 402 path locally**

Add a temporary line to `.env.local`:

```
MPP_SECRET_KEY=dev-secret-do-not-ship
```

(Leave `SERVER_PRIVATE_KEY` set so `getMppPayToAddress()` falls back to that.)

Run `pnpm dev` again. In another terminal:

```bash
curl -s -D - -o /dev/null http://localhost:3000/api/mpp/charge
```

Expected: `HTTP/1.1 402` and a `WWW-Authenticate: Payment ...` header containing `method="tempo"` and `intent="charge"`. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mpp/charge/route.ts
git commit -m "feat: add /api/mpp/charge route serving 402 + receipt"
```

---

## Task 4: Create browser MPP charge client helper

**Files:**
- Create: `src/lib/mpp-browser-client.ts`

This module is the browser-side equivalent of the reference's `src/client/charge.ts` but uses a wagmi `walletClient` (provided by the React tree) instead of a viem `PrivateKeyAccount`.

- [ ] **Step 1: Write the helper**

Create `src/lib/mpp-browser-client.ts`:

```ts
import {
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { Challenge, Credential, Receipt } from "mppx";
import { megaethTestnet } from "./chain";

const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export type MppChargeProgress = {
  step:
    | "requesting"
    | "signing"
    | "waiting"
    | "submitting"
    | "done";
};

export type MppChargeSuccess = {
  status: number;
  body: unknown;
  receipt: Receipt.Receipt;
  txHash: `0x${string}`;
  explorerUrl: string;
};

export type MppChargeOptions = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  targetUrl: string;
  onProgress?: (p: MppChargeProgress) => void;
};

export async function payMppCharge(
  options: MppChargeOptions,
): Promise<MppChargeSuccess> {
  const { walletClient, publicClient, account, targetUrl, onProgress } =
    options;

  onProgress?.({ step: "requesting" });
  const challengeResponse = await fetch(targetUrl);
  if (challengeResponse.status !== 402) {
    const text = await challengeResponse.text();
    throw new Error(
      `Expected 402 from ${targetUrl}, got ${challengeResponse.status}: ${text}`,
    );
  }
  const challenge = Challenge.fromResponse(challengeResponse) as Challenge.Challenge<
    {
      amount: string;
      currency: string;
      recipient: string;
      methodDetails?: { chainId?: number };
    },
    "charge",
    "tempo"
  >;

  if (challenge.method !== "tempo" || challenge.intent !== "charge") {
    throw new Error(
      `Unsupported challenge: ${challenge.method}.${challenge.intent}`,
    );
  }

  onProgress?.({ step: "signing" });
  const txHash = await walletClient.writeContract({
    abi: erc20Abi,
    account,
    address: challenge.request.currency as `0x${string}`,
    args: [
      challenge.request.recipient as `0x${string}`,
      BigInt(challenge.request.amount),
    ],
    chain: megaethTestnet,
    functionName: "transfer",
  });

  onProgress?.({ step: "waiting" });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const chainId =
    challenge.request.methodDetails?.chainId ?? megaethTestnet.id;
  const authorization = Credential.serialize({
    challenge,
    payload: { hash: txHash, type: "hash" },
    source: `did:pkh:eip155:${chainId}:${account}`,
  });

  onProgress?.({ step: "submitting" });
  const finalResponse = await fetch(targetUrl, {
    headers: { Authorization: authorization },
  });
  const bodyText = await finalResponse.text();
  if (finalResponse.status !== 200) {
    throw new Error(
      `MPP charge rejected (${finalResponse.status}): ${bodyText}`,
    );
  }
  const body = bodyText ? JSON.parse(bodyText) : null;
  const receipt = Receipt.fromResponse(finalResponse);
  const explorerUrl = `${megaethTestnet.blockExplorers.default.url}/tx/${txHash}`;

  onProgress?.({ step: "done" });
  return {
    status: finalResponse.status,
    body,
    receipt,
    txHash,
    explorerUrl,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. Common pitfalls:
- `Challenge.fromResponse` returns `Challenge.Challenge<Record<string, unknown>>` by default; the `as` cast narrows the `request` shape for downstream code.
- If `Credential.serialize`'s second-arg `challenge` type complains, use `as unknown as Challenge.Challenge` to widen. Don't loosen via `any`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mpp-browser-client.ts
git commit -m "feat: add browser helper for MPP charge flow"
```

---

## Task 5: Create the MppDemo UI panel

**Files:**
- Create: `src/components/MppDemo.tsx`

Match the design language of `src/components/X402Demo.tsx` (rounded card, mono badge, two buttons, success/error blocks).

- [ ] **Step 1: Write the component**

Create `src/components/MppDemo.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { MPP_PROTECTED_PATH } from "@/lib/mpp-config";
import {
  payMppCharge,
  type MppChargeProgress,
  type MppChargeSuccess,
} from "@/lib/mpp-browser-client";

type State =
  | { kind: "idle" }
  | { kind: "loading"; step: string }
  | { kind: "success"; result: MppChargeSuccess }
  | { kind: "error"; message: string };

function stepLabel(step: MppChargeProgress["step"]): string {
  switch (step) {
    case "requesting":
      return "Requesting challenge…";
    case "signing":
      return "Signing transfer in wallet…";
    case "waiting":
      return "Waiting for receipt…";
    case "submitting":
      return "Submitting credential…";
    case "done":
      return "Done";
  }
}

export function MppDemo() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [unauthorized, setUnauthorized] = useState<unknown>(null);

  async function previewUnpaid() {
    setUnauthorized(null);
    setState({ kind: "loading", step: "GET /api/mpp/charge (no payment)" });
    try {
      const res = await fetch(MPP_PROTECTED_PATH);
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // raw text (e.g., 402 with header-only payload)
      }
      const wwwAuth = res.headers.get("WWW-Authenticate");
      setUnauthorized({ status: res.status, wwwAuth, body });
      setState({ kind: "idle" });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "fetch failed",
      });
    }
  }

  async function payAndFetch() {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setState({ kind: "error", message: "Connect wallet first" });
      return;
    }
    setUnauthorized(null);
    try {
      setState({ kind: "loading", step: "Starting…" });
      const result = await payMppCharge({
        walletClient,
        publicClient,
        account: address,
        targetUrl: MPP_PROTECTED_PATH,
        onProgress: (p) =>
          setState({ kind: "loading", step: stepLabel(p.step) }),
      });
      setState({ kind: "success", result });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "payment failed",
      });
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/60">
        mpp
      </span>
      <h3 className="mt-3 text-lg font-medium text-white">
        Pay 1 USDm via MPP → Protected Content
      </h3>
      <p className="mt-1 text-sm text-white/50">
        Plain ERC20 transfer on MegaETH. Client pays gas.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={previewUnpaid}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 transition hover:bg-white/10"
        >
          Preview 402 (no payment)
        </button>
        <button
          type="button"
          disabled={!isConnected || state.kind === "loading"}
          onClick={payAndFetch}
          className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/90"
        >
          {state.kind === "loading" ? state.step : "Pay 1 USDm via MPP & Fetch"}
        </button>
      </div>

      {unauthorized !== null && (
        <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/70">
{JSON.stringify(unauthorized, null, 2)}
        </pre>
      )}

      {state.kind === "success" && (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-400">
              Response
            </p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/80">
{JSON.stringify(state.result.body, null, 2)}
            </pre>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-white/50">
              Transaction
            </p>
            <a
              href={state.result.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all rounded-lg bg-black/40 p-3 font-mono text-[11px] text-sky-300 underline-offset-2 hover:underline"
            >
              {state.result.txHash}
            </a>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-white/50">
              Receipt
            </p>
            <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/60">
{JSON.stringify(state.result.receipt, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <p className="mt-4 break-words font-mono text-[11px] text-red-400">
          {state.message}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. If wagmi types complain about `walletClient` shape, leave the local typing — `payMppCharge` declares `WalletClient` and the runtime types from wagmi narrow correctly.

- [ ] **Step 3: Commit**

```bash
git add src/components/MppDemo.tsx
git commit -m "feat: add MppDemo panel mirroring x402 demo UX"
```

---

## Task 6: Wire MppDemo into the home page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update the page**

Replace the contents of `src/app/page.tsx` with:

```tsx
import { MppDemo } from "@/components/MppDemo";
import { ServerHealth } from "@/components/ServerHealth";
import { UsdmPanel } from "@/components/UsdmPanel";
import { WalletPanel } from "@/components/WalletPanel";
import { X402Demo } from "@/components/X402Demo";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">
          MegaETH Testnet
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          Payment Demo Sandbox
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-white/60">
          Connect a wallet, mint test USDm, then pay 1 USDm via either x402
          (Permit2, server-sponsored gas) or MPP (plain ERC20 transfer, client
          pays gas) to fetch a protected endpoint.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <WalletPanel />
        <ServerHealth />
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <UsdmPanel />
        <X402Demo />
      </section>

      <section className="grid grid-cols-1 gap-6">
        <MppDemo />
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: render MppDemo on home page"
```

---

## Task 7: Document new env vars

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Append MPP block to .env.example**

Append to the end of `/Users/rubick/Desktop/project/mega-payment-demo/.env.example`:

```
# --- mpp ---
# HMAC secret used by mppx to sign 402 challenges. Required to enable /api/mpp/charge.
MPP_SECRET_KEY=
# Recipient of the 1 USDm MPP payment. Falls back to NEXT_PUBLIC_X402_PAY_TO,
# X402_PAY_TO, or SERVER_PRIVATE_KEY's address.
MPP_PAY_TO=
# Optional client-visible MPP recipient override.
NEXT_PUBLIC_MPP_PAY_TO=
# Human-readable amount of USDm to charge (default 1).
MPP_CHARGE_AMOUNT=
```

- [ ] **Step 2: Update README env table**

In `README.md`, find the env table (the one starting `| Var | Where | Purpose |`). Append rows immediately after the existing `NEXT_PUBLIC_USDM_ADDRESS` row, before the next `##` heading:

```markdown
| `MPP_SECRET_KEY` | server | HMAC secret for mppx 402 challenges (required for `/api/mpp/charge`) |
| `MPP_PAY_TO` | server | Recipient of MPP payments (falls back to x402 / server signer) |
| `NEXT_PUBLIC_MPP_PAY_TO` | client | Optional client-visible override |
| `MPP_CHARGE_AMOUNT` | server | Human-readable USDm amount (default `1`) |
```

In the same file, find the `## Routes` section and append:

```markdown
- `GET /api/mpp/charge` — MPP `tempo.charge` protected endpoint; returns 402 without a credential, 200 + `Payment-Receipt` with one
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document MPP env vars and route"
```

---

## Task 8: End-to-end manual smoke

This task is manual because the project has no test harness — same as the existing x402 demo.

**Pre-reqs in `.env.local`:**
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — set
- `SERVER_PRIVATE_KEY` — a funded MegaETH testnet key (faucet via testnet.megaeth.com)
- `MPP_SECRET_KEY` — any non-empty string (e.g., `openssl rand -hex 32` output)
- USDm balance on the connected browser wallet (use the existing `UsdmPanel` faucet first if needed)
- A small amount of MegaETH ETH on the connected wallet for gas

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

Open http://localhost:3000.

- [ ] **Step 2: Verify 503 if MPP_SECRET_KEY is removed**

Temporarily comment out `MPP_SECRET_KEY` in `.env.local`, restart `pnpm dev`, click "Preview 402 (no payment)" in the MPP panel.

Expected: the preview JSON shows `"status": 503` and `"missingEnv": ["MPP_SECRET_KEY"]`. Restore the env var and restart.

- [ ] **Step 3: Verify 402 preview**

Click "Preview 402 (no payment)".

Expected: preview shows `"status": 402` and a non-empty `wwwAuth` field starting with `Payment ` followed by parameters including `method="tempo"` and `intent="charge"`.

- [ ] **Step 4: Connect wallet**

Use the WalletPanel "Connect" button. Confirm wallet is on MegaETH Testnet (chain id 6343). Mint USDm via the UsdmPanel faucet if balance is 0. Make sure wallet has some MegaETH ETH for gas.

- [ ] **Step 5: Pay and fetch**

Click "Pay 1 USDm via MPP & Fetch".

Expected UI sequence (button label updates):
1. `Requesting challenge…`
2. Wallet popup asks to confirm `transfer(<recipient>, 1000000000000000000)` to the USDm contract
3. After signing: `Waiting for receipt…`
4. After mining: `Submitting credential…`
5. Success block appears showing:
   - Response JSON containing `"secret": "🎉 You paid 1 USDm via MPP. Here is the protected content."`
   - Tx hash linking to `https://www.megaexplorer.xyz/tx/0x...`
   - Receipt JSON with `"method": "tempo"`, `"status": "success"`, and `"reference"` equal to the tx hash

- [ ] **Step 6: Verify recipient balance changed**

Either via the MegaETH block explorer (open the tx hash from the success block) or by switching the wallet to the recipient address and re-checking USDm balance.

Expected: recipient gained 1 USDm; payer's USDm balance decreased by 1 (plus some ETH gas).

- [ ] **Step 7: Sanity check error paths**

- Disconnect wallet → "Pay" button disabled. ✓
- With wallet connected but 0 USDm → wallet rejects or tx reverts → error block shows the error text. ✓
- After successful payment, immediately click "Pay" again → another transfer goes through (new challenge each time, no replay reuse expected since `mppx` HMAC-binds challenge IDs).

- [ ] **Step 8: No commit needed**

Manual smoke step — nothing to commit.

---

## Self-Review

**Spec coverage:**
- Server route — Task 3 ✓
- Config — Task 2 ✓
- Browser helper — Task 4 ✓
- UI panel — Task 5 ✓
- Page wiring — Task 6 ✓
- Env vars + docs — Task 7 ✓
- mppx dep — Task 1 ✓
- Manual error-path coverage — Task 8 ✓

**Placeholder scan:** None — every step has executable commands or full code.

**Type consistency:**
- `MPP_PROTECTED_PATH`, `MPP_CHARGE_AMOUNT_HUMAN`, `MPP_TOKEN_ADDRESS`, `MPP_TOKEN_DECIMALS`, `getMppSecretKey`, `getMppPayToAddress`, `getMppReadiness` exported by Task 2; consumed by Tasks 3 and 5 ✓
- `payMppCharge`, `MppChargeProgress`, `MppChargeSuccess`, `MppChargeOptions` exported by Task 4; consumed by Task 5 ✓
- `MppDemo` exported by Task 5; consumed by Task 6 ✓
