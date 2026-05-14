import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDM_ADDRESS, USDM_DECIMALS } from "./usdm";

export const MPP_SESSION_PROTECTED_PATH = "/api/mpp/session";

const ESCROW_RAW =
  process.env.NEXT_PUBLIC_MPP_SESSION_ESCROW ??
  process.env.MPP_SESSION_ESCROW;
if (!ESCROW_RAW) {
  throw new Error(
    "NEXT_PUBLIC_MPP_SESSION_ESCROW (or MPP_SESSION_ESCROW) is required",
  );
}
export const MPP_SESSION_ESCROW_CONTRACT: Address = getAddress(ESCROW_RAW);

export const MPP_SESSION_REQUEST_AMOUNT_HUMAN =
  process.env.NEXT_PUBLIC_MPP_SESSION_REQUEST_AMOUNT ??
  process.env.MPP_SESSION_REQUEST_AMOUNT ??
  "1";

export const MPP_SESSION_DEPOSIT_AMOUNT_HUMAN =
  process.env.NEXT_PUBLIC_MPP_SESSION_DEPOSIT_AMOUNT ??
  process.env.MPP_SESSION_DEPOSIT_AMOUNT ??
  "10";

export const MPP_SESSION_TOKEN_ADDRESS: Address = USDM_ADDRESS;
export const MPP_SESSION_TOKEN_DECIMALS = USDM_DECIMALS;

export type MppSessionReadiness = {
  ready: boolean;
  missingEnv: string[];
};

export function getMppSecretKey(): string | undefined {
  return process.env.MPP_SECRET_KEY;
}

export function getMppSessionPayToAddress(): Address | null {
  if (process.env.PAY_TO) return getAddress(process.env.PAY_TO);
  const pk = process.env.SERVER_PRIVATE_KEY;
  if (pk) {
    const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
    return privateKeyToAccount(normalized).address;
  }
  return null;
}

export function getMppSessionReadiness(): MppSessionReadiness {
  const missingEnv: string[] = [];
  if (!getMppSecretKey()) missingEnv.push("MPP_SECRET_KEY");
  if (!process.env.SERVER_PRIVATE_KEY) missingEnv.push("SERVER_PRIVATE_KEY");
  if (!getMppSessionPayToAddress())
    missingEnv.push("PAY_TO (or SERVER_PRIVATE_KEY)");
  return { ready: missingEnv.length === 0, missingEnv };
}
