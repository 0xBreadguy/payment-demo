export function prependMppSessionRequest<T>(
  requests: readonly T[],
  request: T,
): T[] {
  return [request, ...requests];
}

export function getMppSessionRequestDisplayNumber(
  totalRequests: number,
  newestFirstIndex: number,
): number {
  return totalRequests - newestFirstIndex;
}

export function getMppSessionCloseRefundAmount(
  depositAmount: bigint,
  settledAmount: bigint,
): string {
  const refundAmount = depositAmount - settledAmount;
  return refundAmount > BigInt(0) ? refundAmount.toString() : "0";
}
