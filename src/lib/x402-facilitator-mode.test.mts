import assert from "node:assert/strict";
import test from "node:test";

const modeModuleUrl = new URL("./x402-facilitator-mode.ts", import.meta.url).href;

test("uses the local x402 facilitator when no explicit facilitator URL is configured", async () => {
  const { getX402FacilitatorMode } = (await import(modeModuleUrl)) as typeof import("./x402-facilitator-mode");

  assert.equal(getX402FacilitatorMode(""), "local");
  assert.equal(getX402FacilitatorMode(undefined), "local");
});

test("uses an HTTP facilitator only when an explicit facilitator URL is configured", async () => {
  const { getX402FacilitatorMode } = (await import(modeModuleUrl)) as typeof import("./x402-facilitator-mode");

  assert.equal(getX402FacilitatorMode("https://x402.org/facilitator"), "http");
});
