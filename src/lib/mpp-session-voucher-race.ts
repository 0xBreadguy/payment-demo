import { Errors } from "mppx";
import type { Hex } from "viem";
import type { MegaethSessionChannelState } from "./megaeth-session";

type MppSessionVoucherWriter = {
  putChannelIfHighestEquals(
    channelId: Hex,
    expectedHighestVoucherAmount: bigint,
    state: MegaethSessionChannelState,
  ): Promise<boolean>;
};

export async function putMppSessionVoucherChannelOnce(parameters: {
  channelId: Hex;
  expectedHighestVoucherAmount: bigint;
  state: MegaethSessionChannelState;
  store: MppSessionVoucherWriter;
}) {
  const updated = await parameters.store.putChannelIfHighestEquals(
    parameters.channelId,
    parameters.expectedHighestVoucherAmount,
    parameters.state,
  );

  if (!updated) {
    throw new Errors.VerificationFailedError({
      reason:
        "session voucher is stale; another request already advanced this channel",
    });
  }
}
