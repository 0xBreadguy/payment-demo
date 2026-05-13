import { defineChain } from "viem";

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
      name: "MegaExplorer",
      url: "https://www.megaexplorer.xyz",
    },
  },
  testnet: true,
});
