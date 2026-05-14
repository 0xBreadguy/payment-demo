import assert from "node:assert/strict";
import test from "node:test";

const authModuleUrl = new URL("./x402-facilitator-auth.ts", import.meta.url).href;

test("adds Vercel protection bypass headers for the current deployment facilitator", async () => {
  const { getFacilitatorAuthHeaders } = (await import(authModuleUrl)) as typeof import("./x402-facilitator-auth");

  process.env.VERCEL_URL = "payment-demo-cb57rhvxu-zzzkkys-projects.vercel.app";
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass-secret";

  const createAuthHeaders = getFacilitatorAuthHeaders(
    "https://payment-demo-cb57rhvxu-zzzkkys-projects.vercel.app/api/x402/facilitator",
  );

  assert.ok(createAuthHeaders);
  assert.deepEqual(await createAuthHeaders(), {
    supported: { "x-vercel-protection-bypass": "bypass-secret" },
    verify: { "x-vercel-protection-bypass": "bypass-secret" },
    settle: { "x-vercel-protection-bypass": "bypass-secret" },
  });
});

test("does not send Vercel bypass secrets to external facilitators", async () => {
  const { getFacilitatorAuthHeaders } = (await import(authModuleUrl)) as typeof import("./x402-facilitator-auth");

  process.env.VERCEL_URL = "payment-demo-cb57rhvxu-zzzkkys-projects.vercel.app";
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass-secret";

  assert.equal(getFacilitatorAuthHeaders("https://facilitator.example.com"), undefined);
});
