"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { USDM_ADDRESS, USDM_DECIMALS, USDM_SYMBOL, usdmAbi } from "@/lib/usdm";

const EXPLORER = "https://www.megaexplorer.xyz";

export function UsdmPanel() {
  const { address, isConnected } = useAccount();
  const [pending, setPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: balance, refetch } = useReadContract({
    address: USDM_ADDRESS,
    abi: usdmAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 5000 },
  });

  async function handleFaucet() {
    if (!address) return;
    setPending(true);
    setError(null);
    setTxHash(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "faucet failed");
      setTxHash(data.hash);
      setTimeout(() => refetch(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "faucet failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/60">
            {USDM_SYMBOL}
          </span>
          <h3 className="mt-3 text-lg font-medium text-white">USDm Faucet</h3>
          <p className="mt-1 break-all font-mono text-[11px] text-white/40">
            {USDM_ADDRESS}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-3 text-sm">
        <div>
          <dt className="text-white/50">Your balance</dt>
          <dd className="mt-1 font-mono text-white">
            {!isConnected
              ? "Connect wallet"
              : balance !== undefined
                ? `${formatUnits(balance as bigint, USDM_DECIMALS)} ${USDM_SYMBOL}`
                : "—"}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        disabled={!isConnected || pending}
        onClick={handleFaucet}
        className="mt-5 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/90"
      >
        {pending ? "Minting…" : `Mint 100 ${USDM_SYMBOL}`}
      </button>

      {txHash && (
        <p className="mt-3 break-all font-mono text-[11px] text-emerald-400">
          tx{" "}
          <a
            className="underline"
            href={`${EXPLORER}/tx/${txHash}`}
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
