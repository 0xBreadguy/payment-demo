import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import type { MegaethSessionChannelState } from "./megaeth-session";

const replayModuleUrl = new URL(
  "./mpp-session-open-replay.ts",
  import.meta.url,
).href;

const channelId =
  "0x7777777777777777777777777777777777777777777777777777777777777777" as Hex;

const channelState: MegaethSessionChannelState = {
  authorizedSigner: "0x2222222222222222222222222222222222222222",
  chainId: 6343,
  channelId,
  closeRequestedAt: BigInt(0),
  createdAt: "2026-05-25T00:00:00.000Z",
  deposit: BigInt(2),
  escrowContract: "0x3333333333333333333333333333333333333333",
  finalized: false,
  highestVoucherAmount: BigInt(2),
  payee: "0x4444444444444444444444444444444444444444",
  payer: "0x5555555555555555555555555555555555555555",
  settledOnChain: BigInt(0),
  spent: BigInt(2),
  token: "0x6666666666666666666666666666666666666666",
  units: 2,
};

test("allows the first official session open when the server has not recorded the channel", async () => {
  const { assertOfficialMppSessionOpenNotReplayed } = (await import(
    replayModuleUrl
  )) as typeof import("./mpp-session-open-replay");

  await assert.doesNotReject(
    assertOfficialMppSessionOpenNotReplayed({
      channelId,
      store: {
        async getChannel() {
          return null;
        },
      },
    }),
  );
});

test("rejects replayed official session open credentials for an already recorded channel", async () => {
  const { assertOfficialMppSessionOpenNotReplayed } = (await import(
    replayModuleUrl
  )) as typeof import("./mpp-session-open-replay");

  await assert.rejects(
    assertOfficialMppSessionOpenNotReplayed({
      channelId,
      store: {
        async getChannel(requestedChannelId) {
          assert.equal(requestedChannelId, channelId);
          return channelState;
        },
      },
    }),
    /already known to the server/u,
  );
});

test("records the first official session open with an if-absent write", async () => {
  const { putOfficialMppSessionOpenChannelOnce } = (await import(
    replayModuleUrl
  )) as typeof import("./mpp-session-open-replay");

  let recorded: MegaethSessionChannelState | null = null;

  await assert.doesNotReject(
    putOfficialMppSessionOpenChannelOnce({
      channelId,
      state: channelState,
      store: {
        async putChannelIfAbsent(requestedChannelId, state) {
          assert.equal(requestedChannelId, channelId);
          recorded = state;
          return true;
        },
      },
    }),
  );
  assert.deepEqual(recorded, channelState);
});

test("rejects a replay that races after preflight without overwriting state", async () => {
  const { putOfficialMppSessionOpenChannelOnce } = (await import(
    replayModuleUrl
  )) as typeof import("./mpp-session-open-replay");

  await assert.rejects(
    putOfficialMppSessionOpenChannelOnce({
      channelId,
      state: channelState,
      store: {
        async putChannelIfAbsent(requestedChannelId) {
          assert.equal(requestedChannelId, channelId);
          return false;
        },
      },
    }),
    /already known to the server/u,
  );
});
