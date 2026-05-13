"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { useAccount, useBalance, useChainId } from "wagmi";
import { formatEther } from "viem";

type Health = {
  ok: boolean;
  blockNumber?: string;
};

export function WalletPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchHealth = () => {
      fetch("/api/health")
        .then((r) => r.json())
        .then((d) => alive && setHealth(d))
        .catch(() => alive && setHealth({ ok: false }));
    };
    fetchHealth();
    const t = setInterval(fetchHealth, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-white/60">Wallet</h2>
          <p className="mt-1 break-all font-mono text-sm text-white sm:text-base">
            {isConnected ? address : "Not connected"}
          </p>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-white/50">Chain ID</dt>
          <dd className="mt-1 font-mono text-white">{chainId}</dd>
        </div>
        <div>
          <dt className="text-white/50">Block</dt>
          <dd className="mt-1 font-mono text-white">
            {!health
              ? "checking..."
              : health.ok && health.blockNumber
                ? health.blockNumber
                : "unavailable"}
          </dd>
        </div>
        {isConnected && (
          <div>
            <dt className="text-white/50">Balance</dt>
            <dd className="mt-1 break-all font-mono text-white">
              {balance ? `${formatEther(balance.value)} ${balance.symbol}` : "—"}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
