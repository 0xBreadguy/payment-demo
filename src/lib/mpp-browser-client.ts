import {
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { Challenge, Credential, Receipt } from "mppx";
import { megaethTestnet, megaethTxUrl } from "./chain";

const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export type MppChargeProgress = {
  step:
    | "requesting"
    | "signing"
    | "waiting"
    | "submitting"
    | "done";
};

export type MppChargeSuccess = {
  status: number;
  body: unknown;
  receipt: Receipt.Receipt;
  txHash: `0x${string}`;
  explorerUrl: string;
};

export type MppChargeOptions = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  targetUrl: string;
  onProgress?: (p: MppChargeProgress) => void;
};

export async function payMppCharge(
  options: MppChargeOptions,
): Promise<MppChargeSuccess> {
  const { walletClient, publicClient, account, targetUrl, onProgress } =
    options;

  onProgress?.({ step: "requesting" });
  const challengeResponse = await fetch(targetUrl);
  if (challengeResponse.status !== 402) {
    const text = await challengeResponse.text();
    throw new Error(
      `Expected 402 from ${targetUrl}, got ${challengeResponse.status}: ${text}`,
    );
  }
  const challenge = Challenge.fromResponse(challengeResponse) as Challenge.Challenge<
    {
      amount: string;
      currency: string;
      recipient: string;
      methodDetails?: { chainId?: number };
    },
    "charge",
    "tempo"
  >;

  if (challenge.method !== "tempo" || challenge.intent !== "charge") {
    throw new Error(
      `Unsupported challenge: ${challenge.method}.${challenge.intent}`,
    );
  }

  onProgress?.({ step: "signing" });
  const txHash = await walletClient.writeContract({
    abi: erc20Abi,
    account,
    address: challenge.request.currency as `0x${string}`,
    args: [
      challenge.request.recipient as `0x${string}`,
      BigInt(challenge.request.amount),
    ],
    chain: megaethTestnet,
    functionName: "transfer",
  });

  onProgress?.({ step: "waiting" });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const chainId =
    challenge.request.methodDetails?.chainId ?? megaethTestnet.id;
  const authorization = Credential.serialize({
    challenge,
    payload: { hash: txHash, type: "hash" },
    source: `did:pkh:eip155:${chainId}:${account}`,
  });

  onProgress?.({ step: "submitting" });
  const finalResponse = await fetch(targetUrl, {
    headers: { Authorization: authorization },
  });
  const bodyText = await finalResponse.text();
  if (finalResponse.status !== 200) {
    throw new Error(
      `MPP charge rejected (${finalResponse.status}): ${bodyText}`,
    );
  }
  const body = bodyText ? JSON.parse(bodyText) : null;
  const receipt = Receipt.fromResponse(finalResponse);
  const explorerUrl = megaethTxUrl(txHash);

  onProgress?.({ step: "done" });
  return {
    status: finalResponse.status,
    body,
    receipt,
    txHash,
    explorerUrl,
  };
}
