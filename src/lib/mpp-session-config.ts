import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDM_ADDRESS, USDM_DECIMALS } from "./usdm";

export const MPP_SESSION_PROTECTED_PATH = "/api/mpp/session";

const DEFAULT_ESCROW_CONTRACT = "0x6572BFEA6B6EFB653D53F3a787B5e159d2365b69";

export const MPP_SESSION_ESCROW_CONTRACT: Address = getAddress(
  process.env.NEXT_PUBLIC_MPP_SESSION_ESCROW ??
    process.env.MPP_SESSION_ESCROW ??
    DEFAULT_ESCROW_CONTRACT,
);

export const MPP_SESSION_REQUEST_AMOUNT_HUMAN =
  process.env.NEXT_PUBLIC_MPP_SESSION_REQUEST_AMOUNT ??
  process.env.MPP_SESSION_REQUEST_AMOUNT ??
  "0.01";

export const MPP_SESSION_DEPOSIT_AMOUNT_HUMAN =
  process.env.NEXT_PUBLIC_MPP_SESSION_DEPOSIT_AMOUNT ??
  process.env.MPP_SESSION_DEPOSIT_AMOUNT ??
  "0.10";

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
  const candidates = [
    process.env.MPP_SESSION_PAY_TO,
    process.env.MPP_PAY_TO,
    process.env.NEXT_PUBLIC_MPP_PAY_TO,
    process.env.X402_PAY_TO,
    process.env.NEXT_PUBLIC_X402_PAY_TO,
  ];
  for (const candidate of candidates) {
    if (candidate) return getAddress(candidate);
  }
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
    missingEnv.push(
      "MPP_SESSION_PAY_TO (or MPP_PAY_TO, X402_PAY_TO, or SERVER_PRIVATE_KEY)",
    );
  return { ready: missingEnv.length === 0, missingEnv };
}
