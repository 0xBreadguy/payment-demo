import assert from "node:assert/strict";
import test from "node:test";

const {
  getMppSessionCloseRefundAmount,
  getMppSessionRequestDisplayNumber,
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
