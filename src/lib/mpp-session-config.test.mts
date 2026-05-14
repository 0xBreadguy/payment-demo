import assert from "node:assert/strict";
import test from "node:test";

const configModuleUrl = new URL("./mpp-session-config.ts", import.meta.url).href;

function configureBaseEnv() {
  process.env.NEXT_PUBLIC_USDM_ADDRESS =
    "0x2222222222222222222222222222222222222222";
  process.env.NEXT_PUBLIC_MPP_SESSION_ESCROW =
    "0x3333333333333333333333333333333333333333";
  process.env.MPP_SECRET_KEY = "test-secret";
  process.env.SERVER_PRIVATE_KEY =
    "0x1111111111111111111111111111111111111111111111111111111111111111";
  delete process.env.PAY_TO;
}

function clearDurableStoreEnv() {
  delete process.env.MPP_SESSION_STATE_REDIS_REST_URL;
  delete process.env.MPP_SESSION_STATE_REDIS_REST_TOKEN;
  delete process.env.MPP_SESSION_STATE_REDIS_URL;
  delete process.env.MPP_SESSION_STATE_REDIS_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
}

test("requires durable MPP session state on Vercel", async () => {
  configureBaseEnv();
  clearDurableStoreEnv();
  process.env.VERCEL = "1";
  delete process.env.MPP_SESSION_ALLOW_MEMORY_STORE;
  delete process.env.MPP_SESSION_REQUIRE_DURABLE_STORE;

  const { getMppSessionReadiness } =
    (await import(configModuleUrl)) as typeof import("./mpp-session-config");

  const readiness = getMppSessionReadiness();

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missingEnv, [
    "MPP_SESSION_STATE_REDIS_REST_URL and MPP_SESSION_STATE_REDIS_REST_TOKEN (or UPSTASH_REDIS_REST_* / KV_REST_API_*)",
  ]);
});

test("allows explicit in-memory MPP session state override for throwaway demos", async () => {
  configureBaseEnv();
  clearDurableStoreEnv();
  process.env.VERCEL = "1";
  process.env.MPP_SESSION_ALLOW_MEMORY_STORE = "1";
  delete process.env.MPP_SESSION_REQUIRE_DURABLE_STORE;

  const { getMppSessionReadiness } =
    (await import(configModuleUrl)) as typeof import("./mpp-session-config");

  assert.deepEqual(getMppSessionReadiness(), {
    missingEnv: [],
    ready: true,
  });
});
