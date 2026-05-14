import assert from "node:assert/strict";
import test from "node:test";

const {
  appendMppSessionEvent,
  canPayMppSessionRequest,
  getMppSessionEventsNewestFirst,
  getMppSessionCloseRefundAmount,
  getMppSessionRemainingAmount,
} = (await import(new URL("./mpp-session-feed.ts", import.meta.url).href)) as typeof import("./mpp-session-feed");

test("keeps mixed MPP session events in chronological append order and renders newest first", () => {
  const chronologicalEvents = [
    "pay 1",
    "pay 2",
    "top-up 1",
    "pay 3",
    "pay 4",
    "top-up 2",
    "pay 5",
    "close",
  ].reduce(
    (events, event) => appendMppSessionEvent(events, event),
    [] as string[],
  );

  assert.deepEqual(chronologicalEvents, [
    "pay 1",
    "pay 2",
    "top-up 1",
    "pay 3",
    "pay 4",
    "top-up 2",
    "pay 5",
    "close",
  ]);
  assert.deepEqual(getMppSessionEventsNewestFirst(chronologicalEvents), [
    "close",
    "pay 5",
    "top-up 2",
    "pay 4",
    "pay 3",
    "top-up 1",
    "pay 2",
    "pay 1",
  ]);
});

test("clears previous MPP session round events before appending a reopened session request", () => {
  const previousRoundEvents = [
    "pay 1",
    "pay 2",
    "top-up 1",
    "close",
  ];

  assert.deepEqual(
    appendMppSessionEvent(previousRoundEvents, "pay 1", {
      resetBeforeAppend: true,
    }),
    ["pay 1"],
  );
});

test("calculates MPP session close refund from deposit minus settled amount", () => {
  assert.equal(getMppSessionCloseRefundAmount(BigInt(100), BigInt(70)), "30");
});

test("does not report a negative MPP session close refund", () => {
  assert.equal(getMppSessionCloseRefundAmount(BigInt(70), BigInt(100)), "0");
});

test("allows the first MPP session pay before a channel is opened", () => {
  assert.equal(
    canPayMppSessionRequest({ opened: false }, BigInt(1)),
    true,
  );
});

test("allows MPP session pay when deposit balance covers the next request", () => {
  assert.equal(
    canPayMppSessionRequest(
      {
        cumulativeAmount: BigInt(9),
        depositAmount: BigInt(10),
        opened: true,
      },
      BigInt(1),
    ),
    true,
  );
});

test("blocks MPP session pay when deposit balance cannot cover the next request", () => {
  const state = {
    cumulativeAmount: BigInt(10),
    depositAmount: BigInt(10),
    opened: true,
  };

  assert.equal(getMppSessionRemainingAmount(state), BigInt(0));
  assert.equal(canPayMppSessionRequest(state, BigInt(1)), false);
});
