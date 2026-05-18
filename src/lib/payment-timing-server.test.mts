import assert from "node:assert/strict";
import test from "node:test";

const serverTimingModuleUrl = new URL(
  "./payment-timing-server.ts",
  import.meta.url,
).href;
const timingModuleUrl = new URL("./payment-timing.ts", import.meta.url).href;

test("collects server timing and recorded on-chain segments", async () => {
  const { collectPaymentServerTiming, recordPaymentOnChainSegment } =
    (await import(serverTimingModuleUrl)) as typeof import("./payment-timing-server");

  const { value, timing } = await collectPaymentServerTiming(async () => {
    recordPaymentOnChainSegment({
      durationMs: 12.4,
      hash: "0xabc",
      label: "transferFrom",
    });
    return "ok";
  });

  assert.equal(value, "ok");
  assert.equal(timing.chainSide, "server");
  assert.deepEqual(timing.chainSegments, [
    { durationMs: 12, hash: "0xabc", label: "transferFrom" },
  ]);
  assert.equal(timing.onChainMs, 12);
  assert.ok(timing.serverMs >= 0);
});

test("attaches encoded timing to a response header", async () => {
  const { attachPaymentServerTiming } =
    (await import(serverTimingModuleUrl)) as typeof import("./payment-timing-server");
  const { PAYMENT_TIMING_HEADER, readServerPaymentTiming } =
    (await import(timingModuleUrl)) as typeof import("./payment-timing");

  const response = attachPaymentServerTiming(new Response("ok"), {
    chainSide: "none",
    serverMs: 7.2,
  });

  assert.ok(response.headers.has(PAYMENT_TIMING_HEADER));
  assert.deepEqual(readServerPaymentTiming(response.headers), {
    chainSide: "none",
    serverMs: 7,
  });
});
