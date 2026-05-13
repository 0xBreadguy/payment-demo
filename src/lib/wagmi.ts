import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { megaethTestnet } from "./chain";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "demo";

export const wagmiConfig = getDefaultConfig({
  appName: "MegaETH Payment Demo",
  projectId,
  chains: [megaethTestnet],
  transports: {
    [megaethTestnet.id]: http(),
  },
  ssr: true,
});
