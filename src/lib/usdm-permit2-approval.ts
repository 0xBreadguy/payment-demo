import { formatUnits, maxUint256, type Address } from "viem";

export const CANONICAL_PERMIT2_ADDRESS: Address =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const USDM_PERMIT2_APPROVAL_AMOUNT = maxUint256;
export const USDM_PERMIT2_PAYMENT_ALLOWANCE_THRESHOLD = BigInt("1000000000000000000");
export const USDM_PERMIT2_UNLIMITED_ALLOWANCE_THRESHOLD = BigInt(
  "1000000000000000000000000",
);

export function formatPermit2AllowanceLabel(parameters: {
  allowance: bigint | undefined;
  decimals: number;
  symbol: string;
}) {
  const { allowance, decimals, symbol } = parameters;

  if (allowance === undefined) {
    return "checking...";
  }

  if (allowance >= USDM_PERMIT2_UNLIMITED_ALLOWANCE_THRESHOLD) {
    return "Unlimited";
  }

  const formatted = formatUnits(allowance, decimals);
  const [wholePart, fractionPart = ""] = formatted.split(".");
  const trimmedFraction = fractionPart.replace(/0+$/, "");
  const compactFraction = trimmedFraction.slice(0, 4).replace(/0+$/, "");
  const value = compactFraction ? `${wholePart}.${compactFraction}` : wholePart;

  return `${value} ${symbol}`;
}

export type Permit2ApprovalUiState = {
  buttonLabel: string;
  description: string;
  disabled: boolean;
  isComplete: boolean;
  title: string;
};

export function getPermit2ApprovalUiState(parameters: {
  allowance: bigint | undefined;
  isConnected: boolean;
  isPending: boolean;
}): Permit2ApprovalUiState {
  const { allowance, isConnected, isPending } = parameters;
  const hasEnoughAllowance =
    allowance !== undefined && allowance >= USDM_PERMIT2_PAYMENT_ALLOWANCE_THRESHOLD;
  const description = hasEnoughAllowance
    ? "Optional but recommended approval is already set. Future x402 payments and MPP sessions can use one fewer signature interaction."
    : "Optional but recommended: approve Permit2 on-chain now so future x402 payments and MPP sessions can use one fewer signature interaction.";

  if (!isConnected) {
    return {
      buttonLabel: "Connect wallet to approve",
      description,
      disabled: true,
      isComplete: false,
      title: "Connect wallet before approving Permit2.",
    };
  }

  if (isPending) {
    return {
      buttonLabel: "Approving Permit2...",
      description,
      disabled: true,
      isComplete: false,
      title: "Waiting for the Permit2 approval transaction.",
    };
  }

  if (allowance === undefined) {
    return {
      buttonLabel: "Checking Permit2 allowance...",
      description,
      disabled: true,
      isComplete: false,
      title: "Checking the current USDm allowance for Permit2.",
    };
  }

  if (hasEnoughAllowance) {
    return {
      buttonLabel: "Permit2 allowance set",
      description,
      disabled: true,
      isComplete: true,
      title: "Permit2 allowance is already set for x402 payments and MPP sessions.",
    };
  }

  return {
    buttonLabel: "Approve Permit2 (optional but recommended)",
    description,
    disabled: false,
    isComplete: false,
    title: "Approve USDm to canonical Permit2 on-chain.",
  };
}
