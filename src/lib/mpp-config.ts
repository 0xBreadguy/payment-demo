import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDM_ADDRESS, USDM_DECIMALS } from "./usdm";

export const MPP_PROTECTED_PATH = "/api/mpp/charge";
export const MPP_CHARGE_AMOUNT_HUMAN =
  process.env.MPP_CHARGE_AMOUNT ?? "1";
export const MPP_TOKEN_ADDRESS: Address = USDM_ADDRESS;
export const MPP_TOKEN_DECIMALS = USDM_DECIMALS;

export type MppReadiness = {
  ready: boolean;
  missingEnv: string[];
};

export function getMppSecretKey(): string | undefined {
  return process.env.MPP_SECRET_KEY;
}

export function getMppPayToAddress(): Address | null {
  if (process.env.PAY_TO) return getAddress(process.env.PAY_TO);
  const pk = process.env.SERVER_PRIVATE_KEY;
  if (pk) {
    const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
    return privateKeyToAccount(normalized).address;
  }
  return null;
}

export function getMppReadiness(): MppReadiness {
  const missingEnv: string[] = [];
  if (!getMppSecretKey()) missingEnv.push("MPP_SECRET_KEY");
  if (!getMppPayToAddress())
    missingEnv.push("PAY_TO (or SERVER_PRIVATE_KEY)");
  return { ready: missingEnv.length === 0, missingEnv };
}
