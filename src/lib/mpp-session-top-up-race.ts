import { Errors } from "mppx";
import type { Hex } from "viem";
import type { MegaethSessionChannelState } from "./megaeth-session";

type MppSessionTopUpStore = {
  getChannel(channelId: Hex): Promise<MegaethSessionChannelState | null>;
  putChannelIfHighestEquals(
    channelId: Hex,
    expectedHighestVoucherAmount: bigint,
    state: MegaethSessionChannelState,
  ): Promise<boolean>;
};

type MppSessionTopUpOnChainState = Pick<
  MegaethSessionChannelState,
  "closeRequestedAt" | "deposit" | "finalized" | "settledOnChain"
>;

function createUnknownChannelError() {
  return new Errors.VerificationFailedError({
    reason: "session channel is not known to the server",
  });
}

export async function putMppSessionTopUpChannelState(parameters: {
  channelId: Hex;
  onChain: MppSessionTopUpOnChainState;
  store: MppSessionTopUpStore;
}): Promise<MegaethSessionChannelState> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await parameters.store.getChannel(parameters.channelId);
    if (!existing) throw createUnknownChannelError();

    const nextState = {
      ...existing,
      closeRequestedAt: parameters.onChain.closeRequestedAt,
      deposit: parameters.onChain.deposit,
      finalized: parameters.onChain.finalized,
      settledOnChain: parameters.onChain.settledOnChain,
    } satisfies MegaethSessionChannelState;

    const updated = await parameters.store.putChannelIfHighestEquals(
      parameters.channelId,
      existing.highestVoucherAmount,
      nextState,
    );
    if (updated) return nextState;
  }

  throw new Errors.VerificationFailedError({
    reason:
      "session top-up state is stale; another request kept advancing this channel",
  });
}
