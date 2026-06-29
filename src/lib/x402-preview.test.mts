import assert from "node:assert/strict";
import test from "node:test";

const { formatX402PaymentFailure, readX402PreviewResponse } = (await import(new URL("./x402-preview.ts", import.meta.url).href)) as typeof import("./x402-preview");

function encodePaymentRequired(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

test("reads x402 v2 payment requirements from the PAYMENT-REQUIRED header", async () => {
  const paymentRequired = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "http://localhost:3000/api/x402/exact",
      description: "Pay 1 USDm to view the protected content",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:6343",
        amount: "1000000000000000000",
        asset: "0x15e9f2B0A747aC05c7446559306687085D161e5C",
        payTo: "0xFB0DC4CE27f616E93139d5Efe4e31c505De8b28a",
        maxTimeoutSeconds: 300,
        extra: {
          name: "USDm",
          version: "1",
          assetTransferMethod: "permit2",
        },
      },
    ],
  };
  const response = new Response("{}", {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": encodePaymentRequired(paymentRequired),
    },
  });

  const preview = await readX402PreviewResponse(response);

  assert.equal(preview.status, 402);
  assert.deepEqual(preview.body, {});
  assert.deepEqual(preview.paymentRequired, paymentRequired);
});

test("formats the x402 protocol error when a paid retry is rejected", () => {
  assert.equal(
    formatX402PaymentFailure({
      status: 412,
      paymentRequired: {
        x402Version: 2,
        error: "permit2_allowance_required",
        resource: {
          url: "http://localhost:3000/api/x402/exact",
          description: "Pay 1 USDm to view the protected content",
          mimeType: "application/json",
        },
        accepts: [],
      },
      body: {},
    }),
    "x402 payment rejected (412): permit2_allowance_required",
  );
});
