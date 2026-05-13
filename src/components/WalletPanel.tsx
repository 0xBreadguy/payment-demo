"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useChainId } from "wagmi";
import { formatEther } from "viem";

export function WalletPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-white/60">Wallet</h2>
          <p className="mt-1 font-mono text-base text-white">
            {isConnected ? address : "Not connected"}
          </p>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>

      {isConnected && (
        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-white/50">Chain ID</dt>
            <dd className="mt-1 font-mono text-white">{chainId}</dd>
          </div>
          <div>
            <dt className="text-white/50">Balance</dt>
            <dd className="mt-1 font-mono text-white">
              {balance ? `${formatEther(balance.value)} ${balance.symbol}` : "—"}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
