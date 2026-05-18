import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import {
  PAYMENT_TIMING_HEADER,
  encodeServerPaymentTiming,
  roundPaymentDuration,
  type PaymentTimingChainSegment,
  type ServerPaymentTiming,
} from "./payment-timing.ts";

type PaymentServerTimingStore = {
  chainSegments: PaymentTimingChainSegment[];
};

const paymentTimingStorage = new AsyncLocalStorage<PaymentServerTimingStore>();

export async function collectPaymentServerTiming<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; timing: ServerPaymentTiming }> {
  const store: PaymentServerTimingStore = { chainSegments: [] };
  const startedAt = performance.now();
  const value = await paymentTimingStorage.run(store, fn);
  const serverMs = performance.now() - startedAt;
  const chainSegments = store.chainSegments.map((segment) => ({
    ...segment,
    durationMs: roundPaymentDuration(segment.durationMs) ?? 0,
  }));
  const onChainMs =
    chainSegments.length > 0
      ? chainSegments.reduce((total, segment) => total + segment.durationMs, 0)
      : undefined;

  return {
    timing: {
      ...(chainSegments.length > 0 ? { chainSegments } : {}),
      chainSide: chainSegments.length > 0 ? "server" : "none",
      ...(onChainMs !== undefined ? { onChainMs } : {}),
      serverMs: roundPaymentDuration(serverMs) ?? 0,
    },
    value,
  };
}

export function recordPaymentOnChainSegment(
  segment: PaymentTimingChainSegment,
) {
  paymentTimingStorage.getStore()?.chainSegments.push(segment);
}

export function attachPaymentServerTiming(
  response: Response,
  timing: ServerPaymentTiming,
): Response {
  const encoded = encodeServerPaymentTiming(timing);
  try {
    response.headers.set(PAYMENT_TIMING_HEADER, encoded);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(PAYMENT_TIMING_HEADER, encoded);
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}
