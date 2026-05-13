"use client";

import { useEffect, useState } from "react";

type Health = {
  ok: boolean;
  chainId?: number;
  blockNumber?: string;
  serverAddress?: string | null;
  error?: string;
};

export function ServerHealth() {
  const [data, setData] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchHealth = () => {
      fetch("/api/health")
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => alive && setData({ ok: false, error: "fetch failed" }));
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
      <h2 className="text-sm font-medium text-white/60">Backend</h2>
      {!data ? (
        <p className="mt-2 text-sm text-white/50">checking…</p>
      ) : data.ok ? (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-white/50">Block</dt>
            <dd className="mt-1 font-mono text-white">{data.blockNumber}</dd>
          </div>
          <div>
            <dt className="text-white/50">Chain ID</dt>
            <dd className="mt-1 font-mono text-white">{data.chainId}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-white/50">Server signer</dt>
            <dd className="mt-1 break-all font-mono text-xs text-white">
              {data.serverAddress ?? "SERVER_PRIVATE_KEY not set"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-red-400">{data.error}</p>
      )}
    </div>
  );
}
