import assert from "node:assert/strict";
import test from "node:test";

const sessionClientModuleUrl = new URL(
  "./mpp-session-browser-client.ts",
  import.meta.url,
).href;

process.env.NEXT_PUBLIC_USDM_ADDRESS ??=
  "0x15e9f2B0A747aC05c7446559306687085D161e5C";
process.env.NEXT_PUBLIC_MPP_SESSION_ESCROW ??=
  "0x2724f2eEDB52487c81Ed0D20Fb2508B8597B5269";

test("gasless session receipt parser preserves EVM session spec fields", async () => {
  const { buildMppSessionReceipt } =
    (await import(sessionClientModuleUrl)) as typeof import("./mpp-session-browser-client");

  const receipt = buildMppSessionReceipt({
    acceptedCumulative: "250000",
    chainId: 6343,
    challengeId: "challenge-id",
    channelId:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    intent: "session",
    method: "evm",
    reference:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    spent: "250000",
    status: "success",
    timestamp: "2026-04-01T12:08:30.000Z",
    units: 1,
  });

  assert.equal(receipt.method, "evm");
  assert.equal(receipt.intent, "session");
  assert.equal(
    receipt.reference,
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(receipt.chainId, 6343);
});
