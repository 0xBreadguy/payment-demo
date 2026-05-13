import "server-only";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { megaethTestnet } from "./chain";

const rpcUrl = process.env.MEGAETH_RPC_URL ?? "https://carrot.megaeth.com/rpc";

export const publicClient = createPublicClient({
  chain: megaethTestnet,
  transport: http(rpcUrl),
});

function getAccount() {
  const pk = process.env.SERVER_PRIVATE_KEY;
  if (!pk) return null;
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  return privateKeyToAccount(normalized);
}

export function getServerWallet() {
  const account = getAccount();
  if (!account) return null;
  return createWalletClient({
    account,
    chain: megaethTestnet,
    transport: http(rpcUrl),
  });
}

export const serverAccount = getAccount();
