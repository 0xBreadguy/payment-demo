import assert from "node:assert/strict";
import test from "node:test";

const configModuleUrl = new URL("./mpp-gasless-config.ts", import.meta.url).href;

test("reports missing server signer and MPP secret for gasless readiness", async () => {
  process.env.NEXT_PUBLIC_USDM_ADDRESS =
    "0x2222222222222222222222222222222222222222";
  delete process.env.MPP_SECRET_KEY;
  delete process.env.SERVER_PRIVATE_KEY;

  const { getMppGaslessReadiness } =
    (await import(configModuleUrl)) as typeof import("./mpp-gasless-config");

  assert.deepEqual(getMppGaslessReadiness(), {
    missingEnv: ["MPP_SECRET_KEY", "SERVER_PRIVATE_KEY"],
    ready: false,
  });
});
