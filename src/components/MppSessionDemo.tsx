"use client";

import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { ProtectedImageResult } from "@/components/ProtectedImageResult";
import {
  MPP_SESSION_DEPOSIT_AMOUNT_HUMAN,
  MPP_SESSION_PROTECTED_PATH,
  MPP_SESSION_REQUEST_AMOUNT_HUMAN,
} from "@/lib/mpp-session-config";
import {
  canPayMppSessionRequest,
  getMppSessionRemainingAmount,
  getMppSessionRequestDisplayNumber,
  prependMppSessionRequest,
} from "@/lib/mpp-session-feed";
import {
  closeMppSession,
  payMppSessionRequest,
  topUpMppSession,
  type MppSessionCloseResult,
  type MppSessionLocalState,
  type MppSessionProgress,
  type MppSessionRequestResult,
  type MppSessionTopUpResult,
} from "@/lib/mpp-session-browser-client";
import { USDM_DECIMALS, USDM_SYMBOL } from "@/lib/usdm";

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; step: string }
  | { kind: "error"; message: string };

const initialState: MppSessionLocalState = {
  opened: false,
  units: 0,
};

function stepLabel(step: MppSessionProgress["step"]): string {
  switch (step) {
    case "requesting":
      return "Requesting challenge…";
    case "ensuring-approval":
      return "Checking Permit2 allowance…";
    case "approving-permit2":
      return "Approving Permit2 (one-time)…";
    case "signing-permit2":
      return "Signing Permit2 witness…";
    case "signing-voucher":
      return "Signing session voucher…";
    case "submitting":
      return "Submitting to server…";
    case "waiting-tx":
      return "Waiting for tx receipt…";
    case "done":
      return "Done";
  }
}

function fmt(amount: bigint | undefined) {
  if (amount === undefined) return "—";
  return `${formatUnits(amount, USDM_DECIMALS)} ${USDM_SYMBOL}`;
}

function fmtBaseUnits(amount: string | undefined) {
  if (!amount) return "—";
  try {
    return `${formatUnits(BigInt(amount), USDM_DECIMALS)} ${USDM_SYMBOL}`;
  } catch {
    return amount;
  }
}

function shortHex(value?: string) {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

export function MppSessionDemo() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [state, setState] = useState<MppSessionLocalState>(initialState);
  const [requests, setRequests] = useState<MppSessionRequestResult[]>([]);
  const [closeResult, setCloseResult] = useState<MppSessionCloseResult | null>(
    null,
  );
  const [topUpResult, setTopUpResult] = useState<MppSessionTopUpResult | null>(
    null,
  );
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<unknown>(null);
  const loading = phase.kind === "loading";
  const requestAmount = parseUnits(
    MPP_SESSION_REQUEST_AMOUNT_HUMAN,
    USDM_DECIMALS,
  );
  const remainingAmount = getMppSessionRemainingAmount(state);
  const canPay = canPayMppSessionRequest(state, requestAmount);
  const needsTopUp = state.opened && !canPay;

  async function previewUnpaid() {
    setUnauthorized(null);
    setPhase({ kind: "loading", step: "GET /api/mpp/session (no payment)" });
    try {
      const res = await fetch(MPP_SESSION_PROTECTED_PATH);
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // 402 challenge typically has empty body, the data lives in headers
      }
      const wwwAuth = res.headers.get("WWW-Authenticate");
      setUnauthorized({ status: res.status, wwwAuth, body });
      setPhase({ kind: "idle" });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "fetch failed",
      });
    }
  }

  async function payOnce() {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setPhase({ kind: "error", message: "Connect wallet first" });
      return;
    }
    if (!canPay) {
      setPhase({
        kind: "error",
        message: `Session balance is too low. Top up ${MPP_SESSION_DEPOSIT_AMOUNT_HUMAN} ${USDM_SYMBOL} before signing another pay voucher.`,
      });
      return;
    }
    setUnauthorized(null);
    setCloseResult(null);
    try {
      setPhase({ kind: "loading", step: "Starting…" });
      const { result, nextState } = await payMppSessionRequest({
        account: address,
        configuredDepositHuman: MPP_SESSION_DEPOSIT_AMOUNT_HUMAN,
        onProgress: (p) =>
          setPhase({ kind: "loading", step: stepLabel(p.step) }),
        publicClient,
        state,
        targetUrl: MPP_SESSION_PROTECTED_PATH,
        walletClient,
      });
      setRequests((prev) => prependMppSessionRequest(prev, result));
      setState(nextState);
      setPhase({ kind: "idle" });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "payment failed",
      });
    }
  }

  async function topUpSession() {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setPhase({ kind: "error", message: "Connect wallet first" });
      return;
    }
    if (!state.opened) {
      setPhase({ kind: "error", message: "Open a session before top-up" });
      return;
    }
    setUnauthorized(null);
    setCloseResult(null);
    setTopUpResult(null);
    setTopUpError(null);
    try {
      setPhase({ kind: "loading", step: "Starting top-up…" });
      const { result, nextState } = await topUpMppSession({
        account: address,
        configuredDepositHuman: MPP_SESSION_DEPOSIT_AMOUNT_HUMAN,
        onProgress: (p) =>
          setPhase({ kind: "loading", step: stepLabel(p.step) }),
        publicClient,
        state,
        targetUrl: MPP_SESSION_PROTECTED_PATH,
        walletClient,
      });
      setTopUpResult(result);
      setState(nextState);
      setPhase({ kind: "idle" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "top-up failed";
      setTopUpError(message);
      setPhase({
        kind: "error",
        message,
      });
    }
  }

  async function closeChannel() {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setPhase({ kind: "error", message: "Connect wallet first" });
      return;
    }
    if (!state.opened) {
      setPhase({ kind: "error", message: "No open session to close" });
      return;
    }
    try {
      setPhase({ kind: "loading", step: "Starting close…" });
      const { result, nextState } = await closeMppSession({
        account: address,
        onProgress: (p) =>
          setPhase({ kind: "loading", step: stepLabel(p.step) }),
        publicClient,
        state,
        targetUrl: MPP_SESSION_PROTECTED_PATH,
        walletClient,
      });
      setCloseResult(result);
      setState(nextState);
      setPhase({ kind: "idle" });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "close failed",
      });
    }
  }

  function resetLocal() {
    setState(initialState);
    setRequests([]);
    setCloseResult(null);
    setTopUpResult(null);
    setTopUpError(null);
    setUnauthorized(null);
    setPhase({ kind: "idle" });
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/60">
        mpp · session
      </span>
      <h3 className="mt-3 text-lg font-medium text-white">
        Pay-as-you-go session ({MPP_SESSION_REQUEST_AMOUNT_HUMAN} {USDM_SYMBOL}/
        request)
      </h3>
      <p className="mt-1 text-sm text-white/50">
        Permit2 + off-chain vouchers. Server pays gas for open / top-up /
        close. Deposit{" "}
        {MPP_SESSION_DEPOSIT_AMOUNT_HUMAN} {USDM_SYMBOL} on first request, then
        sign a voucher per request. Close to settle on-chain and refund unused
        deposit.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={previewUnpaid}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 transition hover:bg-white/10"
        >
          Preview 402
        </button>
        <button
          type="button"
          disabled={!isConnected || loading || !canPay}
          onClick={payOnce}
          className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/90"
        >
          {loading
            ? phase.step
            : state.opened
              ? `Pay ${MPP_SESSION_REQUEST_AMOUNT_HUMAN} ${USDM_SYMBOL} (voucher)`
              : `Open & pay first ${MPP_SESSION_REQUEST_AMOUNT_HUMAN} ${USDM_SYMBOL}`}
        </button>
        <button
          type="button"
          disabled={!isConnected || !state.opened || loading}
          onClick={topUpSession}
          className="rounded-lg border border-emerald-300/30 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Top up {MPP_SESSION_DEPOSIT_AMOUNT_HUMAN} {USDM_SYMBOL}
        </button>
        <button
          type="button"
          disabled={!state.opened || loading}
          onClick={closeChannel}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Close & refund
        </button>
        <button
          type="button"
          onClick={resetLocal}
          className="rounded-lg border border-white/10 px-3 py-2 text-[10px] uppercase tracking-wider text-white/40 transition hover:bg-white/5"
        >
          Reset UI
        </button>
      </div>

      {needsTopUp && (
        <p className="mt-3 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          Session balance is {fmt(remainingAmount)}. Top up{" "}
          {MPP_SESSION_DEPOSIT_AMOUNT_HUMAN} {USDM_SYMBOL} before signing
          another pay voucher.
        </p>
      )}

      {topUpError && (
        <p className="mt-3 break-words rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 font-mono text-[11px] text-red-300">
          Top-up failed: {topUpError}
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-black/30 p-4 font-mono text-[11px] text-white/70 sm:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            Status
          </p>
          <p>{state.opened ? "open" : closeResult ? "closed" : "idle"}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            Units
          </p>
          <p>{state.units}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            Cumulative
          </p>
          <p>{fmt(state.cumulativeAmount)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            Deposit
          </p>
          <p>{fmt(state.depositAmount)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            Remaining
          </p>
          <p>{fmt(remainingAmount)}</p>
        </div>
        <div className="col-span-2 sm:col-span-2">
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            channelId
          </p>
          <p className="break-all">{shortHex(state.channelId)}</p>
        </div>
      </div>

      {unauthorized !== null && (
        <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/70">
{JSON.stringify(unauthorized, null, 2)}
        </pre>
      )}

      {topUpResult && (
        <div className="mt-5 space-y-2">
          <p className="text-xs uppercase tracking-wider text-emerald-400">
            Top-up
          </p>
          <div className="rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/80">
            {topUpResult.explorerUrl && topUpResult.txHash ? (
              <a
                href={topUpResult.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-sky-300 underline-offset-2 hover:underline"
              >
                top-up tx · {shortHex(topUpResult.txHash)}
              </a>
            ) : (
              <p className="text-white/50">top-up accepted</p>
            )}
            <p className="mt-1 text-white/50">
              added {fmtBaseUnits(topUpResult.additionalDeposit)}
            </p>
          </div>
        </div>
      )}

      {closeResult && (
        <div className="mt-5 space-y-2">
          <p className="text-xs uppercase tracking-wider text-amber-400">
            Closed
          </p>
          <div className="rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/80">
            <a
              href={closeResult.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="block break-all text-sky-300 underline-offset-2 hover:underline"
            >
              close tx · {shortHex(closeResult.txHash)}
            </a>
            <p className="mt-1 text-white/50">
              settled {fmtBaseUnits(closeResult.receipt.acceptedCumulative)}
            </p>
            <p className="mt-1 text-white/50">
              refunded {fmtBaseUnits(closeResult.refundAmount)}
            </p>
          </div>
        </div>
      )}

      {requests.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="text-xs uppercase tracking-wider text-emerald-400">
            Requests ({requests.length})
          </p>
          <div className="space-y-2">
            {requests.map((entry, index) => (
              <div
                key={`${entry.receipt.challengeId}-${entry.receipt.acceptedCumulative}-${entry.action}`}
                className="rounded-lg bg-black/40 p-3 font-mono text-[11px] text-white/80"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-white/50">
                    #
                    {getMppSessionRequestDisplayNumber(
                      requests.length,
                      index,
                    )}{" "}
                    · {entry.action}
                  </span>
                  <span className="text-white/40">
                    cum {entry.receipt.acceptedCumulative}
                  </span>
                </div>
                {entry.explorerUrl && entry.txHash && (
                  <a
                    href={entry.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all text-sky-300 underline-offset-2 hover:underline"
                  >
                    open tx · {shortHex(entry.txHash)}
                  </a>
                )}
                <div className="mt-3">
                  <ProtectedImageResult data={entry.body} layout="compact" />
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-white/40">
                    body / receipt
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-white/60">
{JSON.stringify({ body: entry.body, receipt: entry.receipt }, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase.kind === "error" && (
        <p className="mt-4 break-words font-mono text-[11px] text-red-400">
          {phase.message}
        </p>
      )}
    </div>
  );
}
