import assert from "node:assert/strict";
import test from "node:test";

const authModuleUrl = new URL("./x402-facilitator-auth.ts", import.meta.url).href;
const configModuleUrl = new URL("./x402-config.ts", import.meta.url).href;

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

test("prefers the token EIP-712 domain over x402 fallback values", async () => {
  process.env.NEXT_PUBLIC_USDM_ADDRESS =
    "0x15e9f2B0A747aC05c7446559306687085D161e5C";
  process.env.NEXT_PUBLIC_X402_TOKEN_VERSION = "1";

  const { selectX402TokenDomain } =
    (await import(configModuleUrl)) as typeof import("./x402-config");

  const selected = selectX402TokenDomain({
    fallbackName: "USDm",
    fallbackVersion: "1",
    tokenDomainName: "Mock USDm",
    tokenDomainVersion: "1",
  });

  assert.deepEqual(selected, {
    tokenName: "Mock USDm",
    tokenVersion: "1",
  });
});
