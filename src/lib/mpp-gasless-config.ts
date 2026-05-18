import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { MPP_GASLESS_PROTECTED_PATH } from "./mpp-gasless-shared.ts";

const USDM_ADDRESS_RAW = process.env.NEXT_PUBLIC_USDM_ADDRESS;
if (!USDM_ADDRESS_RAW) {
  throw new Error("NEXT_PUBLIC_USDM_ADDRESS is required");
}

export { MPP_GASLESS_PROTECTED_PATH };
export const MPP_GASLESS_CHARGE_AMOUNT_HUMAN =
  process.env.MPP_GASLESS_CHARGE_AMOUNT ??
  process.env.MPP_CHARGE_AMOUNT ??
  "1";
export const MPP_GASLESS_TOKEN_ADDRESS: Address = getAddress(USDM_ADDRESS_RAW);
export const MPP_GASLESS_TOKEN_DECIMALS = 18;
export const MPP_GASLESS_EXPLICIT_TOKEN_NAME =
  process.env.NEXT_PUBLIC_MPP_GASLESS_TOKEN_NAME;
export const MPP_GASLESS_EXPLICIT_TOKEN_VERSION =
  process.env.NEXT_PUBLIC_MPP_GASLESS_TOKEN_VERSION;
export const MPP_GASLESS_TOKEN_NAME =
  MPP_GASLESS_EXPLICIT_TOKEN_NAME ??
  "USDm";
export const MPP_GASLESS_TOKEN_VERSION =
  MPP_GASLESS_EXPLICIT_TOKEN_VERSION ??
  process.env.NEXT_PUBLIC_X402_TOKEN_VERSION ??
  "1";

export type MppGaslessReadiness = {
  ready: boolean;
  missingEnv: string[];
};

export function getMppGaslessSecretKey(): string | undefined {
  return process.env.MPP_SECRET_KEY;
}

function getServerAccount() {
  const pk = process.env.SERVER_PRIVATE_KEY;
  if (!pk) return null;
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  return privateKeyToAccount(normalized);
}

export function getMppGaslessSpenderAddress(): Address | null {
  return getServerAccount()?.address ?? null;
}

export function getMppGaslessPayToAddress(): Address | null {
  if (process.env.PAY_TO) return getAddress(process.env.PAY_TO);
  return getServerAccount()?.address ?? null;
}

export function getMppGaslessReadiness(): MppGaslessReadiness {
  const missingEnv: string[] = [];
  if (!getMppGaslessSecretKey()) missingEnv.push("MPP_SECRET_KEY");
  if (!getMppGaslessSpenderAddress()) missingEnv.push("SERVER_PRIVATE_KEY");
  return { ready: missingEnv.length === 0, missingEnv };
}
