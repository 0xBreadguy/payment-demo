"use client";

import { useState } from "react";
import { type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { megaethTestnet, megaethTxUrl } from "@/lib/chain";
import {
  CANONICAL_PERMIT2_ADDRESS,
  formatPermit2AllowanceLabel,
  getPermit2ApprovalUiState,
  USDM_PERMIT2_APPROVAL_AMOUNT,
} from "@/lib/usdm-permit2-approval";
import { USDM_ADDRESS, USDM_DECIMALS, USDM_SYMBOL, usdmAbi } from "@/lib/usdm";

export function Permit2Panel() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [pending, setPending] = useState(false);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: permit2Allowance, refetch: refetchPermit2Allowance } = useReadContract({
    address: USDM_ADDRESS,
    abi: usdmAbi,
    functionName: "allowance",
    args: address ? [address, CANONICAL_PERMIT2_ADDRESS] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 5000 },
  });

  const normalizedPermit2Allowance =
    typeof permit2Allowance === "bigint" ? permit2Allowance : undefined;
  const approvalState = getPermit2ApprovalUiState({
    allowance: normalizedPermit2Allowance,
    isConnected,
    isPending: pending,
  });

  async function handleApproval() {
    if (!address || !walletClient || !publicClient || approvalState.disabled) return;
    setPending(true);
    setError(null);
    setTxHash(null);
    try {
      const hash = await walletClient.writeContract({
        abi: usdmAbi,
        account: address,
        address: USDM_ADDRESS,
        args: [CANONICAL_PERMIT2_ADDRESS, USDM_PERMIT2_APPROVAL_AMOUNT],
        chain: megaethTestnet,
        functionName: "approve",
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      await refetchPermit2Allowance();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Permit2 approval failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/60">
        Permit2
      </span>
      <h3 className="mt-3 text-lg font-medium text-white">USDm Permit2 Approval</h3>
      <p className="mt-1 break-all font-mono text-[11px] text-white/40">
        {CANONICAL_PERMIT2_ADDRESS}
      </p>

      <dl className="mt-5 grid grid-cols-1 gap-3 text-sm">
        <div>
          <dt className="text-white/50">Current allowance</dt>
          <dd className="mt-1 max-w-full font-mono text-white">
            {!isConnected
              ? "Connect wallet"
              : normalizedPermit2Allowance !== undefined
                ? formatPermit2AllowanceLabel({
                    allowance: normalizedPermit2Allowance,
                    decimals: USDM_DECIMALS,
                    symbol: USDM_SYMBOL,
                  })
                : "checking..."}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        disabled={approvalState.disabled}
        onClick={handleApproval}
        title={approvalState.title}
        className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-white/10"
      >
        {approvalState.buttonLabel}
      </button>

      <p
        className={`mt-2 text-xs ${
          approvalState.isComplete ? "text-emerald-400" : "text-white/50"
        }`}
      >
        {approvalState.description}
      </p>

      {txHash && (
        <p className="mt-3 break-all font-mono text-[11px] text-emerald-400">
          tx{" "}
          <a
            className="underline"
            href={megaethTxUrl(txHash)}
            target="_blank"
            rel="noreferrer"
          >
            {txHash}
          </a>
        </p>
      )}
      {error && (
        <p className="mt-3 break-words font-mono text-[11px] text-red-400">{error}</p>
      )}
    </div>
  );
}
