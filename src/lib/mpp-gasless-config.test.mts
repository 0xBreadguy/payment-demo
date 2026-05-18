import assert from "node:assert/strict";
import test from "node:test";

function configModuleUrl(testName: string) {
  const url = new URL("./mpp-gasless-config.ts", import.meta.url);
  url.searchParams.set("test", testName);
  return url.href;
}

test("reports missing server signer and MPP secret for gasless readiness", async () => {
  process.env.NEXT_PUBLIC_USDM_ADDRESS =
    "0x2222222222222222222222222222222222222222";
  delete process.env.MPP_SECRET_KEY;
  delete process.env.SERVER_PRIVATE_KEY;

  const { getMppGaslessReadiness } =
    (await import(configModuleUrl("readiness"))) as typeof import("./mpp-gasless-config");

  assert.deepEqual(getMppGaslessReadiness(), {
    missingEnv: ["MPP_SECRET_KEY", "SERVER_PRIVATE_KEY"],
    ready: false,
  });
});

test("does not use x402 token name env as the gasless MPP token name fallback", async () => {
  process.env.NEXT_PUBLIC_USDM_ADDRESS =
    "0x2222222222222222222222222222222222222222";
  process.env[["NEXT_PUBLIC", "X402", "TOKEN", "NAME"].join("_")] =
    "Wrong X402 Name";
  delete process.env.NEXT_PUBLIC_MPP_GASLESS_TOKEN_NAME;

  const { MPP_GASLESS_TOKEN_NAME } =
    (await import(configModuleUrl("x402-name-fallback"))) as typeof import("./mpp-gasless-config");

  assert.equal(MPP_GASLESS_TOKEN_NAME, "USDm");
});
