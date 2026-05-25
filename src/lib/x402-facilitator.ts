import "server-only";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { megaethTestnet } from "./chain";
import {
  sendTransactionRealtime,
  writeContractRealtime,
} from "./megaeth-realtime";
import { X402_NETWORK } from "./x402-config";

let cached: x402Facilitator | null = null;

export function getFacilitator(): x402Facilitator | null {
  if (cached) return cached;
  const pk = process.env.SERVER_PRIVATE_KEY;
  if (!pk) return null;
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  const account = privateKeyToAccount(normalized);
  const rpcUrl = process.env.MEGAETH_RPC_URL ?? "https://carrot.megaeth.com/rpc";

  const viemClient = createWalletClient({
    account,
    chain: megaethTestnet,
    transport: http(rpcUrl),
  }).extend(publicActions);
  const realtimeReceipts = new Map<
    `0x${string}`,
    Awaited<ReturnType<typeof viemClient.waitForTransactionReceipt>>
  >();

  function rememberRealtimeReceipt(
    receipt: Awaited<ReturnType<typeof viemClient.waitForTransactionReceipt>>,
  ) {
    realtimeReceipts.set(receipt.transactionHash, receipt);
    return receipt.transactionHash;
  }

  const evmSigner = toFacilitatorEvmSigner({
    address: account.address,
    getCode: (args) => viemClient.getCode(args),
    readContract: (args) =>
      viemClient.readContract({ ...args, args: args.args ?? [] } as Parameters<
        typeof viemClient.readContract
      >[0]),
    verifyTypedData: (args) =>
      viemClient.verifyTypedData(args as Parameters<typeof viemClient.verifyTypedData>[0]),
    writeContract: async (args) =>
      rememberRealtimeReceipt(
        await writeContractRealtime(viemClient, {
          ...args,
          args: args.args ?? [],
        } as Parameters<typeof viemClient.writeContract>[0]),
      ),
    sendTransaction: async (args) =>
      rememberRealtimeReceipt(
        await sendTransactionRealtime(
          viemClient,
          args as Parameters<typeof viemClient.sendTransaction>[0],
        ),
      ),
    waitForTransactionReceipt: (args) => {
      const receipt = realtimeReceipts.get(args.hash);
      if (receipt) {
        realtimeReceipts.delete(args.hash);
        return Promise.resolve(receipt);
      }
      return viemClient.waitForTransactionReceipt(args);
    },
  });

  cached = new x402Facilitator();
  cached.register(X402_NETWORK, new ExactEvmScheme(evmSigner));
  return cached;
}

export function getFacilitatorAccountAddress(): `0x${string}` | null {
  const pk = process.env.SERVER_PRIVATE_KEY;
  if (!pk) return null;
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  return privateKeyToAccount(normalized).address;
}
