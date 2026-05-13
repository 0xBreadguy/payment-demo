"use client";

import type { Address, PublicClient, WalletClient } from "viem";
import type { ClientEvmSigner } from "@x402/evm";

export function buildBrowserSigner(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
): ClientEvmSigner {
  return {
    address,
    signTypedData: async (msg) =>
      walletClient.signTypedData({
        account: address,
        domain: msg.domain as Parameters<WalletClient["signTypedData"]>[0]["domain"],
        types: msg.types as Parameters<WalletClient["signTypedData"]>[0]["types"],
        primaryType: msg.primaryType,
        message: msg.message as Parameters<WalletClient["signTypedData"]>[0]["message"],
      }),
    readContract: (args) =>
      publicClient.readContract({
        ...args,
        args: args.args ?? [],
      } as Parameters<PublicClient["readContract"]>[0]),
  };
}
