import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import type { MegaethSessionChannelState } from "./megaeth-session";

const voucherModuleUrl = new URL(
  "./mpp-session-voucher-race.ts",
  import.meta.url,
).href;

const channelId =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;

const channelState: MegaethSessionChannelState = {
  authorizedSigner: "0x2222222222222222222222222222222222222222",
  chainId: 6343,
  channelId,
  closeRequestedAt: BigInt(0),
  createdAt: "2026-05-14T00:00:00.000Z",
  deposit: BigInt(10),
  escrowContract: "0x3333333333333333333333333333333333333333",
  finalized: false,
  highestVoucherAmount: BigInt(4),
  payee: "0x4444444444444444444444444444444444444444",
  payer: "0x5555555555555555555555555555555555555555",
  settledOnChain: BigInt(1),
  spent: BigInt(4),
  token: "0x6666666666666666666666666666666666666666",
  units: 4,
};

test("records a voucher state update when the stored highest amount still matches", async () => {
  const { putMppSessionVoucherChannelOnce } =
    (await import(voucherModuleUrl)) as typeof import("./mpp-session-voucher-race");
  const calls: unknown[][] = [];

  await putMppSessionVoucherChannelOnce({
    channelId,
    expectedHighestVoucherAmount: BigInt(3),
    state: channelState,
    store: {
      async putChannelIfHighestEquals(
        requestedChannelId,
        expectedHighestVoucherAmount,
        state,
      ) {
        calls.push([requestedChannelId, expectedHighestVoucherAmount, state]);
        return true;
      },
    },
  });

  assert.deepEqual(calls, [[channelId, BigInt(3), channelState]]);
});

test("rejects a voucher state update when another request already advanced the channel", async () => {
  const { putMppSessionVoucherChannelOnce } =
    (await import(voucherModuleUrl)) as typeof import("./mpp-session-voucher-race");

  await assert.rejects(
    putMppSessionVoucherChannelOnce({
      channelId,
      expectedHighestVoucherAmount: BigInt(3),
      state: channelState,
      store: {
        async putChannelIfHighestEquals() {
          return false;
        },
      },
    }),
    /session voucher is stale/,
  );
});
