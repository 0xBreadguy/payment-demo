import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import type { MegaethSessionChannelState } from "./megaeth-session";

const storeModuleUrl = new URL("./mpp-session-store.ts", import.meta.url).href;

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
  highestVoucherAmount: BigInt(3),
  payee: "0x4444444444444444444444444444444444444444",
  payer: "0x5555555555555555555555555555555555555555",
  settledOnChain: BigInt(1),
  spent: BigInt(3),
  token: "0x6666666666666666666666666666666666666666",
  units: 3,
};

test("serializes MPP session channel state without losing bigint values", async () => {
  const { deserializeMppSessionChannelState, serializeMppSessionChannelState } =
    (await import(storeModuleUrl)) as typeof import("./mpp-session-store");

  const serialized = serializeMppSessionChannelState(channelState);

  assert.equal(serialized.deposit, "10");
  assert.equal(serialized.highestVoucherAmount, "3");
  assert.equal(serialized.settledOnChain, "1");
  assert.deepEqual(deserializeMppSessionChannelState(serialized), channelState);
});

test("inserts MPP session channel state only when absent in memory", async () => {
  const { createMemoryMppSessionStore } =
    (await import(storeModuleUrl)) as typeof import("./mpp-session-store");
  const store = createMemoryMppSessionStore();
  const competingState = {
    ...channelState,
    highestVoucherAmount: BigInt(9),
    spent: BigInt(9),
    units: 9,
  };

  assert.equal(await store.putChannelIfAbsent(channelId, channelState), true);
  assert.equal(await store.putChannelIfAbsent(channelId, competingState), false);
  assert.deepEqual(await store.getChannel(channelId), channelState);
});

test("advances MPP session voucher state only when the stored highest value matches in memory", async () => {
  const { createMemoryMppSessionStore } =
    (await import(storeModuleUrl)) as typeof import("./mpp-session-store");
  const store = createMemoryMppSessionStore();
  const firstVoucherState = {
    ...channelState,
    highestVoucherAmount: BigInt(4),
    spent: BigInt(4),
    units: 4,
  };
  const duplicateVoucherState = {
    ...channelState,
    highestVoucherAmount: BigInt(4),
    spent: BigInt(4),
    units: 99,
  };

  await store.putChannel(channelId, channelState);

  const results = await Promise.all([
    store.putChannelIfHighestEquals(
      channelId,
      channelState.highestVoucherAmount,
      firstVoucherState,
    ),
    store.putChannelIfHighestEquals(
      channelId,
      channelState.highestVoucherAmount,
      duplicateVoucherState,
    ),
  ]);

  assert.deepEqual(results.sort(), [false, true]);
  assert.deepEqual(await store.getChannel(channelId), firstVoucherState);
});

test("stores MPP session channel state through Upstash Redis REST", async () => {
  const { createUpstashMppSessionStore } =
    (await import(storeModuleUrl)) as typeof import("./mpp-session-store");

  const values = new Map<string, string>();
  const commands: unknown[][] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    commands.push(command);

    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer redis-token",
    );

    const [name, key, value, option] = command;
    if (name === "EVAL") {
      const [, script, keys, redisKey, expectedHighest, nextValue] = command;
      assert.equal(typeof script, "string");
      assert.equal(keys, "1");
      assert.equal(typeof redisKey, "string");
      assert.equal(typeof expectedHighest, "string");
      assert.equal(typeof nextValue, "string");

      const current = values.get(redisKey as string);
      if (!current) return Response.json({ result: 0 });
      const state = JSON.parse(current) as { highestVoucherAmount?: string };
      if (state.highestVoucherAmount !== expectedHighest) {
        return Response.json({ result: 0 });
      }

      values.set(redisKey as string, nextValue as string);
      return Response.json({ result: 1 });
    }
    if (name === "SET" && typeof key === "string" && typeof value === "string") {
      if (option === "NX" && values.has(key)) {
        return Response.json({ result: null });
      }
      values.set(key, value);
      return Response.json({ result: "OK" });
    }
    if (name === "GET" && typeof key === "string") {
      return Response.json({ result: values.get(key) ?? null });
    }
    if (name === "DEL" && typeof key === "string") {
      const existed = values.delete(key);
      return Response.json({ result: existed ? 1 : 0 });
    }

    return Response.json({ error: "unexpected command" }, { status: 400 });
  };

  const store = createUpstashMppSessionStore({
    fetcher,
    keyPrefix: "test:mpp-session:",
    token: "redis-token",
    url: "https://redis.example.com",
  });

  await store.putChannel(channelId, channelState);
  assert.deepEqual(commands[0], [
    "SET",
    `test:mpp-session:${channelId}`,
    JSON.stringify(serializeForAssertion(channelState)),
  ]);

  assert.deepEqual(await store.getChannel(channelId), channelState);

  const competingState = {
    ...channelState,
    highestVoucherAmount: BigInt(9),
    spent: BigInt(9),
    units: 9,
  };
  const nextVoucherState = {
    ...channelState,
    highestVoucherAmount: BigInt(4),
    spent: BigInt(4),
    units: 4,
  };
  assert.equal(
    await store.putChannelIfHighestEquals(
      channelId,
      channelState.highestVoucherAmount,
      nextVoucherState,
    ),
    true,
  );
  assert.equal(
    await store.putChannelIfHighestEquals(
      channelId,
      channelState.highestVoucherAmount,
      competingState,
    ),
    false,
  );
  assert.deepEqual(await store.getChannel(channelId), nextVoucherState);
  assert.equal(commands.at(-2)?.[0], "EVAL");
  assert.equal(commands.at(-2)?.[1] === "GET", false);

  assert.equal(await store.putChannelIfAbsent(channelId, competingState), false);
  assert.deepEqual(await store.getChannel(channelId), nextVoucherState);

  await store.deleteChannel(channelId);
  assert.equal(await store.putChannelIfAbsent(channelId, competingState), true);
  assert.deepEqual(await store.getChannel(channelId), competingState);

  await store.deleteChannel(channelId);
  assert.equal(await store.getChannel(channelId), null);
});

function serializeForAssertion(state: MegaethSessionChannelState) {
  return {
    ...state,
    closeRequestedAt: state.closeRequestedAt.toString(),
    deposit: state.deposit.toString(),
    highestVoucherAmount: state.highestVoucherAmount.toString(),
    settledOnChain: state.settledOnChain.toString(),
    spent: state.spent.toString(),
  };
}
