"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { x402Client, x402HTTPClient, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ProtectedImageResult } from "@/components/ProtectedImageResult";
import { buildBrowserSigner } from "@/lib/x402-browser-signer";
import { readX402PreviewResponse } from "@/lib/x402-preview";

const PROTECTED_PATH = "/api/protected";

type State =
  | { kind: "idle" }
  | { kind: "loading"; step: string }
  | { kind: "success"; data: unknown; settle: unknown }
  | { kind: "error"; message: string };

export function X402Demo() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [unauthorized, setUnauthorized] = useState<unknown>(null);

  async function previewUnpaid() {
    setUnauthorized(null);
    setState({ kind: "loading", step: "GET /api/protected (no payment)" });
    try {
      const res = await fetch(PROTECTED_PATH, {
        headers: { Accept: "application/json" },
      });
      setUnauthorized(await readX402PreviewResponse(res));
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "fetch failed" });
    }
  }

  async function payAndFetch() {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setState({ kind: "error", message: "Connect wallet first" });
      return;
    }
    setUnauthorized(null);
    try {
      setState({ kind: "loading", step: "Signing payment authorization…" });
      const signer = buildBrowserSigner(walletClient, publicClient, address);
      const client = new x402Client();
      client.register("eip155:*", new ExactEvmScheme(signer));
      const httpClient = new x402HTTPClient(client);
      const fetchWithPayment = wrapFetchWithPayment(fetch, httpClient);

      setState({ kind: "loading", step: "Submitting payment + fetching content…" });
      const res = await fetchWithPayment(PROTECTED_PATH, { method: "GET" });
      const data = await res.json();
      const settle = httpClient.getPaymentSettleResponse((n) => res.headers.get(n));
      setState({ kind: "success", data, settle });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "payment failed" });
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/60">
        x402
      </span>
      <h3 className="mt-3 text-lg font-medium text-white">Pay 1 USDm → Protected Content</h3>
      <p className="mt-1 text-sm text-white/50">
        Permit2 signature, gas sponsored by server facilitator.
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
          {state.kind === "loading" ? state.step : "Pay 1 USDm & Fetch"}
        </button>
      </div>

      {unauthorized !== null && (
        <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/70">
{JSON.stringify(unauthorized, null, 2)}
        </pre>
      )}

      {state.kind === "success" && (
        <div className="mt-4 space-y-3">
          <ProtectedImageResult data={state.data} layout="compact" />
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-400">Response</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/80">
{JSON.stringify(state.data, null, 2)}
            </pre>
          </div>
          {state.settle !== null && (
            <div>
              <p className="text-xs uppercase tracking-wider text-white/50">Settle response</p>
              <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/60">
{JSON.stringify(state.settle, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <p className="mt-4 break-words font-mono text-[11px] text-red-400">{state.message}</p>
      )}
    </div>
  );
}
