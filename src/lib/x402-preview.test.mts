import assert from "node:assert/strict";
import test from "node:test";

const { readX402PreviewResponse } = (await import(new URL("./x402-preview.ts", import.meta.url).href)) as typeof import("./x402-preview");

function encodePaymentRequired(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

test("reads x402 v2 payment requirements from the PAYMENT-REQUIRED header", async () => {
  const paymentRequired = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "http://localhost:3000/api/protected",
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
