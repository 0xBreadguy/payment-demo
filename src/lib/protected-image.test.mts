import assert from "node:assert/strict";
import test from "node:test";

const {
  getRandomProtectedImage,
  PROTECTED_IMAGE_COUNT,
  PROTECTED_IMAGE_SIZE,
  PROTECTED_IMAGES,
} = (await import(new URL("./protected-image.ts", import.meta.url).href)) as typeof import("./protected-image");

test("builds stable public URLs for the 512x512 protected images", () => {
  assert.equal(PROTECTED_IMAGE_COUNT, 100);
  assert.equal(PROTECTED_IMAGE_SIZE, 512);
  assert.equal(PROTECTED_IMAGES.length, PROTECTED_IMAGE_COUNT);
  assert.deepEqual(PROTECTED_IMAGES[0], {
    alt: "Protected image fluffle-01",
    height: 512,
    src: "/512x512/fluffle-01.png",
    width: 512,
  });
  assert.deepEqual(PROTECTED_IMAGES[99], {
    alt: "Protected image fluffle-100",
    height: 512,
    src: "/512x512/fluffle-100.png",
    width: 512,
  });
});

test("selects a deterministic image when random input is injected", () => {
  assert.equal(getRandomProtectedImage(() => 0).src, "/512x512/fluffle-01.png");
  assert.equal(
    getRandomProtectedImage(() => 0.999999).src,
    "/512x512/fluffle-100.png",
  );
});
