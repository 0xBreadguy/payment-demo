import assert from "node:assert/strict";
import test from "node:test";

const evmSessionMethodModuleUrl = new URL(
  "./mpp-evm-session-method.ts",
  import.meta.url,
).href;

test("normalizes EVM session requests for MPP challenges", async () => {
  const {
    EVM_SESSION_INTENT,
    EVM_SESSION_METHOD_NAME,
    evmSessionMethod,
  } = (await import(evmSessionMethodModuleUrl)) as
    typeof import("./mpp-evm-session-method");

  assert.equal(EVM_SESSION_METHOD_NAME, "evm");
  assert.equal(EVM_SESSION_INTENT, "session");
  assert.equal(evmSessionMethod.name, "evm");
  assert.equal(evmSessionMethod.intent, "session");

  const parsed = evmSessionMethod.schema.request.parse({
    amount: "250000",
    chainId: 6343,
    currency: "0x2222222222222222222222222222222222222222",
    escrowContract: "0x3333333333333333333333333333333333333333",
    methodDetails: {
      chainId: 6343,
      credentialTypes: ["hash"],
      escrowContract: "0x3333333333333333333333333333333333333333",
      feePayer: false,
    },
    recipient: "0x4444444444444444444444444444444444444444",
    suggestedDeposit: "2500000",
    unitType: "request",
  });

  assert.deepEqual(parsed, {
    amount: "250000",
    currency: "0x2222222222222222222222222222222222222222",
    methodDetails: {
      chainId: 6343,
      credentialTypes: ["hash"],
      escrowContract: "0x3333333333333333333333333333333333333333",
      feePayer: false,
    },
    recipient: "0x4444444444444444444444444444444444444444",
    suggestedDeposit: "2500000",
    unitType: "request",
  });
});
