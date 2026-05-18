import {
  formatPaymentDuration,
  type PaymentTiming,
} from "@/lib/payment-timing";

function chainSideLabel(timing: PaymentTiming) {
  switch (timing.chainSide) {
    case "client":
      return "client-side";
    case "server":
      return "server-side";
    case "none":
      return "off-chain";
    case "unknown":
      return "not available";
  }
}

export function PaymentTimingMetrics({ timing }: { timing?: PaymentTiming }) {
  return (
    <div className="font-mono text-[11px] text-white/70">
      <p className="text-[10px] uppercase tracking-wider text-white/40">
        Timing
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            Total
          </p>
          <p className="text-white/85">
            {formatPaymentDuration(timing?.totalMs)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            Server
          </p>
          <p className="text-white/85">
            {formatPaymentDuration(timing?.serverMs)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            On-chain
          </p>
          <p className="text-white/85">
            {formatPaymentDuration(timing?.onChainMs)}
          </p>
          {timing && (
            <p className="mt-0.5 text-[10px] text-white/40">
              {chainSideLabel(timing)}
            </p>
          )}
        </div>
      </div>
      {timing?.chainSegments && timing.chainSegments.length > 1 && (
        <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
          {timing.chainSegments.map((segment) => (
            <div
              className="flex flex-wrap justify-between gap-2"
              key={`${segment.label}:${segment.hash ?? segment.durationMs}`}
            >
              <span className="text-white/45">{segment.label}</span>
              <span className="text-white/70">
                {formatPaymentDuration(segment.durationMs)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
