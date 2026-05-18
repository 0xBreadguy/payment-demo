export const PAYMENT_TIMING_HEADER = "X-Payment-Timing";

export type PaymentTimingChainSide = "client" | "server" | "none" | "unknown";

export type PaymentTimingChainSegment = {
  durationMs: number;
  hash?: string;
  label: string;
};

export type ServerPaymentTiming = {
  chainSegments?: PaymentTimingChainSegment[];
  chainSide: Exclude<PaymentTimingChainSide, "client">;
  onChainMs?: number;
  serverMs: number;
};

export type ClientPaymentTiming = {
  chainSegments?: PaymentTimingChainSegment[];
  chainSide?: Extract<PaymentTimingChainSide, "client" | "none" | "unknown">;
  onChainMs?: number;
  totalMs: number;
};

export type PaymentTiming = {
  chainSegments?: PaymentTimingChainSegment[];
  chainSide: PaymentTimingChainSide;
  onChainMs?: number;
  serverMs?: number;
  totalMs: number;
};

export function roundPaymentDuration(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function cleanChainSegments(
  segments: PaymentTimingChainSegment[] | undefined,
) {
  const cleaned = segments
    ?.map((segment) => ({
      ...segment,
      durationMs: roundPaymentDuration(segment.durationMs) ?? 0,
    }))
    .filter((segment) => segment.durationMs >= 0 && segment.label);
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

export function mergePaymentTiming(input: {
  client: ClientPaymentTiming;
  server?: ServerPaymentTiming;
}): PaymentTiming {
  const server = input.server;
  const client = input.client;
  const serverOnChainMs = roundPaymentDuration(server?.onChainMs);
  const clientOnChainMs = roundPaymentDuration(client.onChainMs);
  const serverSegments = cleanChainSegments(server?.chainSegments);
  const clientSegments = cleanChainSegments(client.chainSegments);
  const chainSide =
    server?.chainSide === "server" && serverOnChainMs !== undefined
      ? "server"
      : client.chainSide === "client" && clientOnChainMs !== undefined
        ? "client"
        : server?.chainSide ?? client.chainSide ?? "unknown";
  const onChainMs =
    chainSide === "server"
      ? serverOnChainMs
      : chainSide === "client"
        ? clientOnChainMs
        : undefined;
  const chainSegments =
    chainSide === "server" ? serverSegments : clientSegments;

  return {
    ...(chainSegments ? { chainSegments } : {}),
    chainSide,
    ...(onChainMs !== undefined ? { onChainMs } : {}),
    ...(server?.serverMs !== undefined
      ? { serverMs: roundPaymentDuration(server.serverMs) }
      : {}),
    totalMs: roundPaymentDuration(client.totalMs) ?? 0,
  };
}

export function encodeServerPaymentTiming(timing: ServerPaymentTiming) {
  return encodeURIComponent(
    JSON.stringify({
      ...timing,
      chainSegments: cleanChainSegments(timing.chainSegments),
      onChainMs: roundPaymentDuration(timing.onChainMs),
      serverMs: roundPaymentDuration(timing.serverMs) ?? 0,
    }),
  );
}

export function readServerPaymentTiming(
  headers: Pick<Headers, "get">,
): ServerPaymentTiming | undefined {
  const raw = headers.get(PAYMENT_TIMING_HEADER);
  if (!raw) return undefined;

  try {
    const decoded = JSON.parse(decodeURIComponent(raw)) as Partial<ServerPaymentTiming>;
    const serverMs = roundPaymentDuration(decoded.serverMs);
    if (serverMs === undefined) return undefined;

    const chainSegments = cleanChainSegments(decoded.chainSegments);
    const onChainMs = roundPaymentDuration(decoded.onChainMs);
    const chainSide =
      decoded.chainSide === "server" ||
      decoded.chainSide === "none" ||
      decoded.chainSide === "unknown"
        ? decoded.chainSide
        : "unknown";

    return {
      ...(chainSegments ? { chainSegments } : {}),
      chainSide,
      ...(onChainMs !== undefined ? { onChainMs } : {}),
      serverMs,
    };
  } catch {
    return undefined;
  }
}

export function formatPaymentDuration(value: number | undefined) {
  const rounded = roundPaymentDuration(value);
  if (rounded === undefined) return "—";
  if (rounded === 0) return "<1 ms";
  if (rounded < 1_000) return `${rounded} ms`;
  return `${(rounded / 1_000).toFixed(2)} s`;
}
