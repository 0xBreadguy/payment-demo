import { defineChain } from "viem";

export const MEGAETH_BLOCK_EXPLORER_URL =
  "https://megaeth-testnet-v2.blockscout.com";

export function megaethTxUrl(txHash: string) {
  return `${MEGAETH_BLOCK_EXPLORER_URL}/tx/${txHash}`;
}

export const megaethTestnet = defineChain({
  id: 6343,
  name: "MegaETH Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MEGAETH_RPC_URL ?? "https://carrot.megaeth.com/rpc"],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: MEGAETH_BLOCK_EXPLORER_URL,
    },
  },
  testnet: true,
});
