import { Errors } from "mppx";
import type { Hex } from "viem";
import type { MegaethSessionChannelState } from "./megaeth-session";

type OfficialMppSessionOpenStore = {
  getChannel(channelId: Hex): Promise<MegaethSessionChannelState | null>;
};

type OfficialMppSessionOpenWriter = {
  putChannelIfAbsent(
    channelId: Hex,
    state: MegaethSessionChannelState,
  ): Promise<boolean>;
};

function createReplayError() {
  return new Errors.VerificationFailedError({
    reason:
      "session channel is already known to the server; use a voucher credential instead of replaying open",
  });
}

export async function assertOfficialMppSessionOpenNotReplayed(parameters: {
  channelId: Hex;
  store: OfficialMppSessionOpenStore;
}) {
  const existing = await parameters.store.getChannel(parameters.channelId);

  if (existing) {
    throw createReplayError();
  }
}

export async function putOfficialMppSessionOpenChannelOnce(parameters: {
  channelId: Hex;
  state: MegaethSessionChannelState;
  store: OfficialMppSessionOpenWriter;
}) {
  const inserted = await parameters.store.putChannelIfAbsent(
    parameters.channelId,
    parameters.state,
  );

  if (!inserted) {
    throw createReplayError();
  }
}
