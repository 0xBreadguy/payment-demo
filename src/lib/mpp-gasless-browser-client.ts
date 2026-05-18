import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { Challenge, Credential, Receipt } from "mppx";
import {
  PERMIT20_METHOD_NAME,
  createPermit20Source,
  permit20Erc20Abi,
  signPermit20,
} from "./mpp-permit20.ts";
import {
  mergePaymentTiming,
  readServerPaymentTiming,
  type PaymentTiming,
} from "./payment-timing.ts";

const MEGAETH_TESTNET_EXPLORER = "https://megaeth-testnet-v2.blockscout.com";

export type MppGaslessChargeProgress = {
  step:
    | "requesting"
    | "reading-nonce"
    | "signing-permit"
    | "submitting"
    | "done";
};

export type MppGaslessChargeSuccess = {
  status: number;
  body: unknown;
  receipt: Receipt.Receipt;
  timing: PaymentTiming;
  txHash: `0x${string}`;
  explorerUrl: string;
};

export type MppGaslessChargeOptions = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  targetUrl: string;
  onProgress?: (p: MppGaslessChargeProgress) => void;
};

export type MppGaslessChallenge = Challenge.Challenge<
  {
    amount: string;
    currency: string;
    recipient: string;
    methodDetails?: {
      chainId?: number;
      spender?: string;
      tokenName?: string;
      tokenVersion?: string;
    };
  },
  "charge",
  "permit20"
>;

export function parseMppGaslessChallenge(response: Response): MppGaslessChallenge {
  const challenge = Challenge.fromResponse(response);
  if (
    challenge.method !== PERMIT20_METHOD_NAME ||
    challenge.intent !== "charge"
  ) {
    throw new Error(
      `Unsupported challenge: ${challenge.method}.${challenge.intent}`,
    );
  }
  return challenge as MppGaslessChallenge;
}

function megaethTxUrl(hash: Hex) {
  return `${MEGAETH_TESTNET_EXPLORER}/tx/${hash}`;
}

export async function payMppGaslessCharge(
  options: MppGaslessChargeOptions,
): Promise<MppGaslessChargeSuccess> {
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

  const challenge = parseMppGaslessChallenge(challengeResponse);
  const chainId = challenge.request.methodDetails?.chainId;
  const spender = challenge.request.methodDetails?.spender as Address | undefined;
  const tokenName = challenge.request.methodDetails?.tokenName;
  const tokenVersion = challenge.request.methodDetails?.tokenVersion;
  if (!chainId || !spender || !tokenName || !tokenVersion) {
    throw new Error("Gasless MPP challenge is missing permit20 methodDetails.");
  }

  const token = challenge.request.currency as Address;
  const value = BigInt(challenge.request.amount);

  onProgress?.({ step: "reading-nonce" });
  const nonce = await publicClient.readContract({
    abi: permit20Erc20Abi,
    address: token,
    args: [account],
    functionName: "nonces",
  });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  onProgress?.({ step: "signing-permit" });
  const signature = await signPermit20({
    account,
    chainId,
    client: walletClient,
    deadline,
    nonce,
    owner: account,
    spender,
    token,
    tokenName,
    tokenVersion,
    value,
  });

  const authorization = Credential.serialize({
    challenge,
    payload: {
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      owner: account,
      signature,
      spender,
      type: "permit20",
      value: value.toString(),
    },
    source: createPermit20Source(chainId, account),
  });

  onProgress?.({ step: "submitting" });
  const totalStartedAt = performance.now();
  const finalResponse = await fetch(targetUrl, {
    headers: { Authorization: authorization },
  });
  const bodyText = await finalResponse.text();
  if (finalResponse.status !== 200) {
    throw new Error(
      `MPP gasless charge rejected (${finalResponse.status}): ${bodyText}`,
    );
  }

  const body = bodyText ? JSON.parse(bodyText) : null;
  const receipt = Receipt.fromResponse(finalResponse);
  const txHash = receipt.reference as `0x${string}`;
  const timing = mergePaymentTiming({
    client: {
      chainSide: "unknown",
      totalMs: performance.now() - totalStartedAt,
    },
    server: readServerPaymentTiming(finalResponse.headers),
  });

  onProgress?.({ step: "done" });
  return {
    body,
    explorerUrl: megaethTxUrl(txHash),
    receipt,
    status: finalResponse.status,
    timing,
    txHash,
  };
}
