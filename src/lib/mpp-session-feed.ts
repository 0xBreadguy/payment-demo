export function appendMppSessionEvent<T>(
  events: readonly T[],
  event: T,
  options: { resetBeforeAppend?: boolean } = {},
): T[] {
  const baseEvents = options.resetBeforeAppend ? [] : events;
  return [...baseEvents, event];
}

export function getMppSessionEventsNewestFirst<T>(events: readonly T[]): T[] {
  return [...events].reverse();
}

export function getMppSessionCloseRefundAmount(
  depositAmount: bigint,
  settledAmount: bigint,
): string {
  const refundAmount = depositAmount - settledAmount;
  return refundAmount > BigInt(0) ? refundAmount.toString() : "0";
}

export type MppSessionBalanceState = {
  cumulativeAmount?: bigint;
  depositAmount?: bigint;
  opened: boolean;
};

export function getMppSessionRemainingAmount(
  state: MppSessionBalanceState,
): bigint | undefined {
  if (
    !state.opened ||
    state.cumulativeAmount === undefined ||
    state.depositAmount === undefined
  ) {
    return undefined;
  }

  const remainingAmount = state.depositAmount - state.cumulativeAmount;
  return remainingAmount > BigInt(0) ? remainingAmount : BigInt(0);
}

export function canPayMppSessionRequest(
  state: MppSessionBalanceState,
  requestAmount: bigint,
): boolean {
  if (!state.opened) return true;

  const remainingAmount = getMppSessionRemainingAmount(state);
  return remainingAmount !== undefined && remainingAmount >= requestAmount;
}
