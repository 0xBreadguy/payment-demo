import assert from "node:assert/strict";
import test from "node:test";

const {
  canPayMppSessionRequest,
  getMppSessionCloseRefundAmount,
  getMppSessionRequestDisplayNumber,
  getMppSessionRemainingAmount,
  prependMppSessionRequest,
} = (await import(new URL("./mpp-session-feed.ts", import.meta.url).href)) as typeof import("./mpp-session-feed");

test("prepends new MPP session requests so newest protected image renders first", () => {
  const requests = ["older", "oldest"];

  assert.deepEqual(prependMppSessionRequest(requests, "newest"), [
    "newest",
    "older",
    "oldest",
  ]);
});

test("keeps request labels tied to chronological request number in newest-first order", () => {
  assert.equal(getMppSessionRequestDisplayNumber(3, 0), 3);
  assert.equal(getMppSessionRequestDisplayNumber(3, 1), 2);
  assert.equal(getMppSessionRequestDisplayNumber(3, 2), 1);
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
