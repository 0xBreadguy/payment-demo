import assert from "node:assert/strict";
import test from "node:test";

const { getProtectedImageFrameClassName } = (await import(
  new URL("./protected-image-layout.ts", import.meta.url).href
)) as typeof import("./protected-image-layout");

test("keeps the default protected image layout full width", () => {
  const className = getProtectedImageFrameClassName("full");

  assert.match(className, /\bw-full\b/);
  assert.doesNotMatch(className, /\bmax-w-md\b/);
});

test("limits compact protected images to roughly the x402 card width", () => {
  const className = getProtectedImageFrameClassName("compact");

  assert.match(className, /\bw-full\b/);
  assert.match(className, /\bmax-w-md\b/);
});
