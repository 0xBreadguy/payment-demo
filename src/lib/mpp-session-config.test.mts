import assert from "node:assert/strict";
import test from "node:test";

const configModuleUrl = new URL("./mpp-session-config.ts", import.meta.url);

let importCounter = 0;

async function importConfig() {
  const url = new URL(configModuleUrl);
  url.searchParams.set("case", String(importCounter++));
  return (await import(url.href)) as typeof import("./mpp-session-config");
}

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

  const { getMppSessionReadiness } = await importConfig();

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

  const { getMppSessionReadiness } = await importConfig();

  assert.deepEqual(getMppSessionReadiness(), {
    missingEnv: [],
    ready: true,
  });
});

test("exports separate official and gasless MPP session route constants", async () => {
  configureBaseEnv();
  clearDurableStoreEnv();
  delete process.env.VERCEL;
  delete process.env.MPP_SESSION_REQUIRE_DURABLE_STORE;

  const {
    MPP_SESSION_GASLESS_PROTECTED_PATH,
    MPP_SESSION_PROTECTED_PATH,
  } = await importConfig();

  assert.equal(MPP_SESSION_PROTECTED_PATH, "/api/mpp/session");
  assert.equal(
    MPP_SESSION_GASLESS_PROTECTED_PATH,
    "/api/mpp/session-gasless",
  );
});

test("requires session payee to match server signer so close can settle", async () => {
  configureBaseEnv();
  clearDurableStoreEnv();
  delete process.env.VERCEL;
  process.env.PAY_TO = "0x2222222222222222222222222222222222222222";

  const { getMppSessionReadiness } = await importConfig();

  const readiness = getMppSessionReadiness();
  assert.equal(readiness.ready, false);
  assert.ok(
    readiness.missingEnv.includes(
      "PAY_TO must match SERVER_PRIVATE_KEY address for MPP session close",
    ),
  );
});
