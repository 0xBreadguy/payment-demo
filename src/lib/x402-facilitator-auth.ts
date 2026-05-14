import type { FacilitatorConfig } from "@x402/core/server";

type FacilitatorAuthHeaders = NonNullable<FacilitatorConfig["createAuthHeaders"]>;

const VERCEL_BYPASS_HEADER = "x-vercel-protection-bypass";

function normalizeHostname(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

function shouldAttachVercelBypass(facilitatorUrl: string): boolean {
  const facilitatorHost = normalizeHostname(facilitatorUrl);
  if (!facilitatorHost) return false;

  const currentVercelHosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .map(normalizeHostname)
    .filter((host): host is string => Boolean(host));

  return currentVercelHosts.includes(facilitatorHost);
}

export function getFacilitatorAuthHeaders(
  facilitatorUrl: string,
): FacilitatorAuthHeaders | undefined {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!bypassSecret || !shouldAttachVercelBypass(facilitatorUrl)) return undefined;

  return async () => {
    const headers = { [VERCEL_BYPASS_HEADER]: bypassSecret };
    return {
      supported: headers,
      verify: headers,
      settle: headers,
    };
  };
}
