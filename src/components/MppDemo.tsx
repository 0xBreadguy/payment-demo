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
