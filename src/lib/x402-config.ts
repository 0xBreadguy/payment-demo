import { getAddress, type Address } from "viem";
import { megaethTestnet } from "./chain";
import { USDM_ADDRESS } from "./usdm";

export const X402_NETWORK = `eip155:${megaethTestnet.id}` as const;

export const X402_TOKEN_ADDRESS: Address = USDM_ADDRESS;
export const X402_TOKEN_NAME = process.env.NEXT_PUBLIC_X402_TOKEN_NAME ?? "USDm";
export const X402_TOKEN_VERSION = process.env.NEXT_PUBLIC_X402_TOKEN_VERSION ?? "1";

// 1 token, 18 decimals
export const X402_TOKEN_PRICE = "1000000000000000000";
export const X402_PROTECTED_PATH = "/api/protected";

export function getFacilitatorUrl(req?: Request): string {
  const explicit = process.env.X402_FACILITATOR_URL;
  if (explicit) return explicit;
  if (req) {
    const u = new URL(req.url);
    return `${u.origin}/api/x402/facilitator`;
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}/api/x402/facilitator`;
  return "http://localhost:3000/api/x402/facilitator";
}

export function getPayToAddress(fallback: Address): Address {
  return process.env.PAY_TO ? getAddress(process.env.PAY_TO) : fallback;
}
