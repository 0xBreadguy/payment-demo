import assert from "node:assert/strict";
import test from "node:test";

const timingModuleUrl = new URL("./payment-timing.ts", import.meta.url).href;

test("merges client-side chain timing with server duration", async () => {
  const { mergePaymentTiming } =
    (await import(timingModuleUrl)) as typeof import("./payment-timing");

  assert.deepEqual(
    mergePaymentTiming({
      client: {
        chainSide: "client",
        onChainMs: 1_425.44,
        totalMs: 1_680.2,
      },
      server: {
        chainSide: "none",
        serverMs: 185.9,
      },
    }),
    {
      chainSide: "client",
      onChainMs: 1425,
      serverMs: 186,
      totalMs: 1680,
    },
  );
});

test("uses server-side chain timing when the server settles on-chain", async () => {
  const { mergePaymentTiming } =
    (await import(timingModuleUrl)) as typeof import("./payment-timing");

  assert.deepEqual(
    mergePaymentTiming({
      client: {
        totalMs: 2_812.8,
      },
      server: {
        chainSegments: [
          { durationMs: 802.2, hash: "0xpermit", label: "permit" },
          { durationMs: 1_104.6, hash: "0xtransfer", label: "transferFrom" },
        ],
        chainSide: "server",
        onChainMs: 1_906.8,
        serverMs: 2_430.4,
      },
    }),
    {
      chainSegments: [
        { durationMs: 802, hash: "0xpermit", label: "permit" },
        { durationMs: 1105, hash: "0xtransfer", label: "transferFrom" },
      ],
      chainSide: "server",
      onChainMs: 1907,
      serverMs: 2430,
      totalMs: 2813,
    },
  );
});

test("keeps off-chain server timing when no transaction is written", async () => {
  const { mergePaymentTiming } =
    (await import(timingModuleUrl)) as typeof import("./payment-timing");

  assert.deepEqual(
    mergePaymentTiming({
      client: {
        chainSide: "unknown",
        totalMs: 95.4,
      },
      server: {
        chainSide: "none",
        serverMs: 77.2,
      },
    }),
    {
      chainSide: "none",
      serverMs: 77,
      totalMs: 95,
    },
  );
});

test("round trips server timing through the response header", async () => {
  const {
    PAYMENT_TIMING_HEADER,
    encodeServerPaymentTiming,
    readServerPaymentTiming,
  } = (await import(timingModuleUrl)) as typeof import("./payment-timing");

  const headers = new Headers({
    [PAYMENT_TIMING_HEADER]: encodeServerPaymentTiming({
      chainSegments: [{ durationMs: 44.5, label: "openWithPermit2" }],
      chainSide: "server",
      onChainMs: 44.5,
      serverMs: 88.1,
    }),
  });

  assert.deepEqual(readServerPaymentTiming(headers), {
    chainSegments: [{ durationMs: 45, label: "openWithPermit2" }],
    chainSide: "server",
    onChainMs: 45,
    serverMs: 88,
  });
});

test("formats payment durations for compact metric display", async () => {
  const { formatPaymentDuration } =
    (await import(timingModuleUrl)) as typeof import("./payment-timing");

  assert.equal(formatPaymentDuration(undefined), "—");
  assert.equal(formatPaymentDuration(0.4), "<1 ms");
  assert.equal(formatPaymentDuration(42.4), "42 ms");
  assert.equal(formatPaymentDuration(1_234), "1.23 s");
});
