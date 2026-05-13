import { getAddress, parseUnits, type Address } from "viem";

const DEFAULT_USDM_ADDRESS = "0x15e9f2B0A747aC05c7446559306687085D161e5C";

export const USDM_ADDRESS: Address = getAddress(
  process.env.NEXT_PUBLIC_USDM_ADDRESS ?? DEFAULT_USDM_ADDRESS,
);
export const USDM_DECIMALS = 18;
export const USDM_SYMBOL = "USDm";

export const FAUCET_AMOUNT = parseUnits("100", USDM_DECIMALS);

export const usdmAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
