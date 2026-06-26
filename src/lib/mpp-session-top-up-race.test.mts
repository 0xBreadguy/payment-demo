import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import type { MegaethSessionChannelState } from "./megaeth-session";

const topUpModuleUrl = new URL(
  "./mpp-session-top-up-race.ts",
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

test("merges top-up on-chain fields into the latest voucher state after a racing voucher", async () => {
  const { putMppSessionTopUpChannelState } =
    (await import(topUpModuleUrl)) as typeof import("./mpp-session-top-up-race");
  const racedVoucherState = {
    ...channelState,
    highestVoucherAmount: BigInt(5),
    spent: BigInt(5),
    units: 5,
  };
  let latest = channelState;
  const written: MegaethSessionChannelState[] = [];

  const result = await putMppSessionTopUpChannelState({
    channelId,
    onChain: {
      closeRequestedAt: BigInt(2),
      deposit: BigInt(20),
      finalized: false,
      settledOnChain: BigInt(1),
    },
    store: {
      async getChannel() {
        return latest;
      },
      async putChannelIfHighestEquals(_channelId, expectedHighest, state) {
        if (expectedHighest === channelState.highestVoucherAmount) {
          latest = racedVoucherState;
          return false;
        }

        written.push(state);
        latest = state;
        return true;
      },
    },
  });

  assert.equal(result.highestVoucherAmount, BigInt(5));
  assert.equal(result.spent, BigInt(5));
  assert.equal(result.units, 5);
  assert.equal(result.deposit, BigInt(20));
  assert.equal(result.closeRequestedAt, BigInt(2));
  assert.deepEqual(written, [result]);
});

test("rejects top-up state updates when the channel disappears during retries", async () => {
  const { putMppSessionTopUpChannelState } =
    (await import(topUpModuleUrl)) as typeof import("./mpp-session-top-up-race");

  await assert.rejects(
    putMppSessionTopUpChannelState({
      channelId,
      onChain: {
        closeRequestedAt: BigInt(2),
        deposit: BigInt(20),
        finalized: false,
        settledOnChain: BigInt(1),
      },
      store: {
        async getChannel() {
          return null;
        },
        async putChannelIfHighestEquals() {
          throw new Error("putChannelIfHighestEquals should not be called");
        },
      },
    }),
    /session channel is not known/,
  );
});
