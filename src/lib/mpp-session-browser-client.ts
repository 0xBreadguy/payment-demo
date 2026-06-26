import {
  parseUnits,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { Challenge, Credential } from "mppx";
import { megaethTestnet, megaethTxUrl } from "./chain";
import { getMppSessionCloseRefundAmount } from "./mpp-session-feed";
import {
  computeMegaethSessionChannelId,
  createMegaethSessionSource,
  getMegaethErc20Allowance,
  getMegaethErc20Balance,
  getMegaethSessionPaymentPlan,
  PERMIT2_ADDRESS,
  recoverPermit2OpenSigner,
  recoverPermit2TopUpSigner,
  signMegaethSessionVoucher,
  signPermit2OpenWitnessTransfer,
  signPermit2TopUpWitnessTransfer,
} from "./megaeth-session";
import {
  buildMppSessionPermit20ApprovalPayload,
  recoverMppSessionPermit20ApprovalSigner,
  type MppSessionPermit20ApprovalPayload,
} from "./mpp-session-permit20-approval";
import {
  permit20Erc20Abi,
  selectPermit20Domain,
  signPermit20,
} from "./mpp-permit20";
import {
  mergePaymentTiming,
  readServerPaymentTiming,
  type PaymentTiming,
} from "./payment-timing.ts";
import { USDM_DECIMALS } from "./usdm";

export type MppSessionProgressStep =
  | "requesting"
  | "ensuring-approval"
  | "signing-permit20-approval"
  | "signing-permit2"
  | "signing-voucher"
  | "submitting"
  | "waiting-tx"
  | "done";

export type MppSessionProgress = {
  step: MppSessionProgressStep;
};

export type MppSessionLocalState = {
  channelId?: Hex;
  cumulativeAmount?: bigint;
  depositAmount?: bigint;
  escrowContract?: Address;
  opened: boolean;
  units: number;
};

export type MppSessionReceipt = {
  acceptedCumulative: string;
  channelId: string;
  challengeId: string;
  spent: string;
  txHash?: string;
  units?: number;
};

export type MppSessionRequestResult = {
  status: number;
  body: unknown;
  receipt: MppSessionReceipt;
  rawReceipt: Record<string, unknown>;
  timing: PaymentTiming;
  action: "open" | "voucher";
  txHash?: `0x${string}`;
  explorerUrl?: string;
};

export type MppSessionTopUpResult = {
  status: number;
  receipt: MppSessionReceipt;
  rawReceipt: Record<string, unknown>;
  additionalDeposit: string;
  timing: PaymentTiming;
  txHash?: `0x${string}`;
  explorerUrl?: string;
};

export type MppSessionCloseResult = {
  status: number;
  receipt: MppSessionReceipt;
  rawReceipt: Record<string, unknown>;
  refundAmount: string;
  timing: PaymentTiming;
  txHash: `0x${string}`;
  explorerUrl: string;
};

export type MppSessionOptions = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  targetUrl: string;
  configuredDepositHuman: string;
  state: MppSessionLocalState;
  onProgress?: (p: MppSessionProgress) => void;
};

const MPP_SESSION_PERMIT20_EXPLICIT_TOKEN_NAME =
  process.env.NEXT_PUBLIC_MPP_SESSION_TOKEN_NAME;
const MPP_SESSION_PERMIT20_EXPLICIT_TOKEN_VERSION =
  process.env.NEXT_PUBLIC_MPP_SESSION_TOKEN_VERSION ??
  process.env.NEXT_PUBLIC_MPP_GASLESS_TOKEN_VERSION;
const MPP_SESSION_PERMIT20_TOKEN_NAME =
  MPP_SESSION_PERMIT20_EXPLICIT_TOKEN_NAME ?? "USDm";
const MPP_SESSION_PERMIT20_TOKEN_VERSION =
  MPP_SESSION_PERMIT20_EXPLICIT_TOKEN_VERSION ??
  process.env.NEXT_PUBLIC_X402_TOKEN_VERSION ??
  "1";

type SessionChallenge = Challenge.Challenge<
  {
    amount: string;
    currency: string;
    recipient: string;
    methodDetails?: {
      chainId?: number;
      escrowContract?: string;
    };
  },
  "session",
  "tempo"
>;

function parseChallenge(response: Response): SessionChallenge {
  const challenge = Challenge.fromResponse(response);
  if (challenge.method !== "tempo" || challenge.intent !== "session") {
    throw new Error(
      `Unsupported challenge: ${challenge.method}.${challenge.intent}`,
    );
  }
  return challenge as SessionChallenge;
}

function decodeRawReceiptHeader(response: Response): Record<string, unknown> {
  const header = response.headers.get("Payment-Receipt");
  if (!header) throw new Error("Missing Payment-Receipt header.");
  const json = atob(header.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as Record<string, unknown>;
}

function buildSessionReceipt(raw: Record<string, unknown>): MppSessionReceipt {
  return {
    acceptedCumulative: String(raw.acceptedCumulative ?? "0"),
    channelId: String(raw.channelId ?? ""),
    challengeId: String(raw.challengeId ?? ""),
    spent: String(raw.spent ?? "0"),
    txHash: raw.txHash ? String(raw.txHash) : undefined,
    units: typeof raw.units === "number" ? raw.units : undefined,
  };
}

async function readPermit20TokenDomain(
  publicClient: PublicClient,
  token: Address,
) {
  let tokenDomainName: string | undefined;
  let tokenDomainVersion: string | undefined;

  try {
    const domain = await publicClient.readContract({
      abi: permit20Erc20Abi,
      address: token,
      functionName: "eip712Domain",
    });
    const [, name, version] = domain as readonly [
      Hex,
      string,
      string,
      bigint,
      Address,
      Hex,
      readonly bigint[],
    ];
    tokenDomainName = name;
    tokenDomainVersion = version;
  } catch {
    try {
      tokenDomainName = await publicClient.readContract({
        abi: permit20Erc20Abi,
        address: token,
        functionName: "name",
      });
    } catch {
      tokenDomainName = undefined;
    }
  }

  return selectPermit20Domain({
    explicitName: MPP_SESSION_PERMIT20_EXPLICIT_TOKEN_NAME,
    explicitVersion: MPP_SESSION_PERMIT20_EXPLICIT_TOKEN_VERSION,
    fallbackName: MPP_SESSION_PERMIT20_TOKEN_NAME,
    fallbackVersion: MPP_SESSION_PERMIT20_TOKEN_VERSION,
    tokenDomainName,
    tokenDomainVersion,
  });
}

async function preparePermit2AllowanceApproval(
  options: {
    chainId: number;
    publicClient: PublicClient;
    walletClient: WalletClient;
    account: Address;
    token: Address;
    requiredAmount: bigint;
    onProgress?: (p: MppSessionProgress) => void;
  },
): Promise<MppSessionPermit20ApprovalPayload | undefined> {
  const {
    chainId,
    publicClient,
    walletClient,
    account,
    token,
    requiredAmount,
    onProgress,
  } = options;

  onProgress?.({ step: "ensuring-approval" });
  const allowance = await getMegaethErc20Allowance(
    publicClient,
    token,
    account,
    PERMIT2_ADDRESS,
  );

  if (allowance >= requiredAmount) return undefined;

  const [{ tokenName, tokenVersion }, nonce] = await Promise.all([
    readPermit20TokenDomain(publicClient, token),
    publicClient.readContract({
      abi: permit20Erc20Abi,
      address: token,
      args: [account],
      functionName: "nonces",
    }),
  ]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  onProgress?.({ step: "signing-permit20-approval" });
  const signature = await signPermit20({
    account,
    chainId,
    client: walletClient,
    deadline,
    nonce,
    owner: account,
    spender: PERMIT2_ADDRESS,
    token,
    tokenName,
    tokenVersion,
    value: requiredAmount,
  });
  const payload = buildMppSessionPermit20ApprovalPayload({
    deadline,
    nonce,
    owner: account,
    signature,
    value: requiredAmount,
  });
  const recovered = await recoverMppSessionPermit20ApprovalSigner({
    chainId,
    payload,
    token,
    tokenName,
    tokenVersion,
  });
  if (recovered.toLowerCase() !== account.toLowerCase()) {
    throw new Error(
      `USDm permit signature recovers to ${recovered}, expected ${account}. Wallet digest mismatch.`,
    );
  }

  return payload;
}

export async function payMppSessionRequest(
  options: MppSessionOptions,
): Promise<{ result: MppSessionRequestResult; nextState: MppSessionLocalState }> {
  const {
    walletClient,
    publicClient,
    account,
    targetUrl,
    configuredDepositHuman,
    state,
    onProgress,
  } = options;

  onProgress?.({ step: "requesting" });
  const initial = await fetch(targetUrl, { method: "POST" });
  if (initial.status !== 402) {
    const bodyText = await initial.text();
    throw new Error(
      `Expected 402 from ${targetUrl}, got ${initial.status}: ${bodyText}`,
    );
  }

  const challenge = parseChallenge(initial);
  const chainId = challenge.request.methodDetails?.chainId ?? megaethTestnet.id;
  const currency = challenge.request.currency as Address;
  const recipient = challenge.request.recipient as Address;
  const escrowContract = (challenge.request.methodDetails?.escrowContract ??
    state.escrowContract) as Address;
  if (!escrowContract) {
    throw new Error("escrowContract missing from challenge and state");
  }
  const requestAmount = BigInt(challenge.request.amount);
  const configuredDeposit = parseUnits(configuredDepositHuman, USDM_DECIMALS);

  const plan = getMegaethSessionPaymentPlan({
    configuredDeposit,
    requestAmount,
    state:
      state.opened && state.cumulativeAmount !== undefined &&
      state.depositAmount !== undefined
        ? {
            cumulativeAmount: state.cumulativeAmount,
            depositAmount: state.depositAmount,
            opened: state.opened,
          }
        : undefined,
  });

  if (plan.action === "topUp") {
    throw new Error(
      `MPP session balance is too low. Top up ${configuredDepositHuman} USDm before signing another pay voucher.`,
    );
  }

  let action: "open" | "voucher" = "voucher";
  let credential: string;
  let nextState: MppSessionLocalState = state;

  if (plan.action === "open") {
    action = "open";

    // Pre-flight: USDm balance must cover the deposit.
    const balance = await getMegaethErc20Balance(
      publicClient,
      currency,
      account,
    );
    if (balance < plan.depositAmount) {
      throw new Error(
        `Insufficient USDm balance: need ${plan.depositAmount}, have ${balance}. Faucet some USDm first.`,
      );
    }

    const permit20Approval = await preparePermit2AllowanceApproval({
      chainId,
      publicClient,
      walletClient,
      account,
      token: currency,
      requiredAmount: plan.depositAmount,
      onProgress,
    });

    const salt = toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex;
    const channelId = computeMegaethSessionChannelId({
      authorizedSigner: account,
      chainId,
      escrowContract,
      payee: recipient,
      payer: account,
      salt,
      token: currency,
    });

    onProgress?.({ step: "signing-permit2" });
    const permit2Nonce = BigInt(
      toHex(crypto.getRandomValues(new Uint8Array(32))),
    );
    const permit2Deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const permit2SigParams = {
      amount: plan.depositAmount,
      authorizedSigner: account,
      chainId,
      deadline: permit2Deadline,
      nonce: permit2Nonce,
      payee: recipient,
      salt,
      spender: escrowContract,
      token: currency,
    };
    const permit2Signature = await signPermit2OpenWitnessTransfer({
      ...permit2SigParams,
      account: walletClient.account!,
      client: walletClient,
    });

    // Local sig recovery: catch wallet/viem digest mismatch before sending tx.
    const recovered = await recoverPermit2OpenSigner({
      ...permit2SigParams,
      signature: permit2Signature,
    });
    if (recovered.toLowerCase() !== account.toLowerCase()) {
      throw new Error(
        `Permit2 signature recovers to ${recovered}, expected ${account}. Wallet digest mismatch.`,
      );
    }

    onProgress?.({ step: "signing-voucher" });
    const signature = await signMegaethSessionVoucher({
      account: walletClient.account!,
      chainId,
      channelId,
      client: walletClient,
      cumulativeAmount: plan.nextCumulativeAmount,
      escrowContract,
    });

    credential = Credential.serialize({
      challenge,
      payload: {
        action: "open",
        authorizedSigner: account,
        channelId,
        cumulativeAmount: plan.nextCumulativeAmount.toString(),
        deposit: plan.depositAmount.toString(),
        payer: account,
        permit2Deadline: permit2Deadline.toString(),
        permit2Nonce: permit2Nonce.toString(),
        permit2Signature,
        ...(permit20Approval ? { permit20Approval } : {}),
        salt,
        signature,
        token: currency,
        type: "permit2",
      },
      source: createMegaethSessionSource(chainId, account),
    });

    nextState = {
      channelId,
      cumulativeAmount: plan.nextCumulativeAmount,
      depositAmount: plan.depositAmount,
      escrowContract,
      opened: true,
      units: state.units + 1,
    };
  } else {
    if (!state.channelId) {
      throw new Error("Missing channelId for voucher flow");
    }
    action = "voucher";

    onProgress?.({ step: "signing-voucher" });
    const signature = await signMegaethSessionVoucher({
      account: walletClient.account!,
      chainId,
      channelId: state.channelId,
      client: walletClient,
      cumulativeAmount: plan.nextCumulativeAmount,
      escrowContract,
    });

    credential = Credential.serialize({
      challenge,
      payload: {
        action: "voucher",
        channelId: state.channelId,
        cumulativeAmount: plan.nextCumulativeAmount.toString(),
        signature,
      },
      source: createMegaethSessionSource(chainId, account),
    });

    nextState = {
      ...state,
      cumulativeAmount: plan.nextCumulativeAmount,
      escrowContract,
      opened: true,
      units: state.units + 1,
    };
  }

  onProgress?.({ step: "submitting" });
  const totalStartedAt = performance.now();
  const finalResponse = await fetch(targetUrl, {
    method: "POST",
    headers: { Authorization: credential },
  });
  const bodyText = await finalResponse.text();
  if (finalResponse.status !== 200) {
    throw new Error(
      `MPP session rejected (${finalResponse.status}): ${bodyText}`,
    );
  }
  const body = bodyText ? JSON.parse(bodyText) : null;
  const rawReceipt = decodeRawReceiptHeader(finalResponse);
  const receipt = buildSessionReceipt(rawReceipt);
  const timing = mergePaymentTiming({
    client: {
      chainSide: "unknown",
      totalMs: performance.now() - totalStartedAt,
    },
    server: readServerPaymentTiming(finalResponse.headers),
  });

  const txHash =
    action === "open"
      ? (receipt.txHash as `0x${string}` | undefined)
      : undefined;
  const explorerUrl =
    action === "open" && txHash
      ? megaethTxUrl(txHash)
      : undefined;

  onProgress?.({ step: "done" });

  return {
    result: {
      action,
      body,
      explorerUrl,
      rawReceipt,
      receipt,
      status: finalResponse.status,
      timing,
      txHash,
    },
    nextState,
  };
}

export async function topUpMppSession(
  options: MppSessionOptions,
): Promise<{ result: MppSessionTopUpResult; nextState: MppSessionLocalState }> {
  const {
    walletClient,
    publicClient,
    account,
    targetUrl,
    configuredDepositHuman,
    state,
    onProgress,
  } = options;

  if (
    !state.channelId ||
    state.depositAmount === undefined ||
    !state.escrowContract ||
    !state.opened
  ) {
    throw new Error("No active session to top up");
  }

  const additionalDeposit = parseUnits(configuredDepositHuman, USDM_DECIMALS);
  if (additionalDeposit <= BigInt(0)) {
    throw new Error("Top-up amount must be greater than zero");
  }

  onProgress?.({ step: "requesting" });
  const challengeResponse = await fetch(targetUrl, { method: "POST" });
  if (challengeResponse.status !== 402) {
    const text = await challengeResponse.text();
    throw new Error(
      `Expected 402 top-up challenge, got ${challengeResponse.status}: ${text}`,
    );
  }

  const challenge = parseChallenge(challengeResponse);
  const chainId = challenge.request.methodDetails?.chainId ?? megaethTestnet.id;
  const currency = challenge.request.currency as Address;
  const escrowContract = (challenge.request.methodDetails?.escrowContract ??
    state.escrowContract) as Address;
  if (!escrowContract) {
    throw new Error("escrowContract missing from challenge and state");
  }

  const balance = await getMegaethErc20Balance(publicClient, currency, account);
  if (balance < additionalDeposit) {
    throw new Error(
      `Insufficient USDm balance: need ${additionalDeposit}, have ${balance}. Faucet some USDm first.`,
    );
  }

  const permit20Approval = await preparePermit2AllowanceApproval({
    chainId,
    publicClient,
    walletClient,
    account,
    token: currency,
    requiredAmount: additionalDeposit,
    onProgress,
  });

  onProgress?.({ step: "signing-permit2" });
  const permit2Nonce = BigInt(toHex(crypto.getRandomValues(new Uint8Array(32))));
  const permit2Deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const permit2SigParams = {
    amount: additionalDeposit,
    chainId,
    channelId: state.channelId,
    deadline: permit2Deadline,
    nonce: permit2Nonce,
    spender: escrowContract,
    token: currency,
  };
  const permit2Signature = await signPermit2TopUpWitnessTransfer({
    ...permit2SigParams,
    account: walletClient.account!,
    client: walletClient,
  });

  const recovered = await recoverPermit2TopUpSigner({
    ...permit2SigParams,
    signature: permit2Signature,
  });
  if (recovered.toLowerCase() !== account.toLowerCase()) {
    throw new Error(
      `Permit2 top-up signature recovers to ${recovered}, expected ${account}. Wallet digest mismatch.`,
    );
  }

  const credential = Credential.serialize({
    challenge,
    payload: {
      action: "topUp",
      additionalDeposit: additionalDeposit.toString(),
      channelId: state.channelId,
      permit2Deadline: permit2Deadline.toString(),
      permit2Nonce: permit2Nonce.toString(),
      permit2Signature,
      ...(permit20Approval ? { permit20Approval } : {}),
      type: "permit2",
    },
    source: createMegaethSessionSource(chainId, account),
  });

  onProgress?.({ step: "submitting" });
  const totalStartedAt = performance.now();
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { Authorization: credential },
  });
  if (response.status !== 200) {
    const text = await response.text();
    throw new Error(`top-up rejected (${response.status}): ${text}`);
  }

  const rawReceipt = decodeRawReceiptHeader(response);
  const receipt = buildSessionReceipt(rawReceipt);
  const txHash = receipt.txHash as `0x${string}` | undefined;
  const timing = mergePaymentTiming({
    client: {
      chainSide: "unknown",
      totalMs: performance.now() - totalStartedAt,
    },
    server: readServerPaymentTiming(response.headers),
  });

  onProgress?.({ step: "done" });

  return {
    result: {
      additionalDeposit: additionalDeposit.toString(),
      explorerUrl: txHash ? megaethTxUrl(txHash) : undefined,
      rawReceipt,
      receipt,
      status: response.status,
      timing,
      txHash,
    },
    nextState: {
      ...state,
      depositAmount: state.depositAmount + additionalDeposit,
      escrowContract,
      opened: true,
    },
  };
}

export async function closeMppSession(options: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  targetUrl: string;
  state: MppSessionLocalState;
  onProgress?: (p: MppSessionProgress) => void;
}): Promise<{ result: MppSessionCloseResult; nextState: MppSessionLocalState }> {
  const { walletClient, account, targetUrl, state, onProgress } = options;

  if (
    !state.channelId ||
    state.cumulativeAmount === undefined ||
    state.depositAmount === undefined ||
    !state.escrowContract ||
    !state.opened
  ) {
    throw new Error("No active session to close");
  }

  onProgress?.({ step: "requesting" });
  // Send an unauthenticated POST first to receive the challenge for close.
  const challengeResponse = await fetch(targetUrl, { method: "POST" });
  if (challengeResponse.status !== 402) {
    const text = await challengeResponse.text();
    throw new Error(
      `Expected 402 close challenge, got ${challengeResponse.status}: ${text}`,
    );
  }
  const challenge = parseChallenge(challengeResponse);
  const chainId = challenge.request.methodDetails?.chainId ?? megaethTestnet.id;

  onProgress?.({ step: "signing-voucher" });
  const signature = await signMegaethSessionVoucher({
    account: walletClient.account!,
    chainId,
    channelId: state.channelId,
    client: walletClient,
    cumulativeAmount: state.cumulativeAmount,
    escrowContract: state.escrowContract,
  });

  const credential = Credential.serialize({
    challenge,
    payload: {
      action: "close",
      channelId: state.channelId,
      cumulativeAmount: state.cumulativeAmount.toString(),
      signature,
    },
    source: createMegaethSessionSource(chainId, account),
  });

  onProgress?.({ step: "submitting" });
  const totalStartedAt = performance.now();
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { Authorization: credential },
  });
  const bodyText = await response.text();
  if (response.status !== 200) {
    throw new Error(`close rejected (${response.status}): ${bodyText}`);
  }
  const rawReceipt = decodeRawReceiptHeader(response);
  const receipt = buildSessionReceipt(rawReceipt);
  const txHash = (receipt.txHash ?? "") as `0x${string}`;
  const timing = mergePaymentTiming({
    client: {
      chainSide: "unknown",
      totalMs: performance.now() - totalStartedAt,
    },
    server: readServerPaymentTiming(response.headers),
  });

  onProgress?.({ step: "done" });

  return {
    result: {
      explorerUrl: megaethTxUrl(txHash),
      rawReceipt,
      receipt,
      refundAmount: getMppSessionCloseRefundAmount(
        state.depositAmount,
        state.cumulativeAmount,
      ),
      status: response.status,
      timing,
      txHash,
    },
    nextState: {
      channelId: state.channelId,
      cumulativeAmount: state.cumulativeAmount,
      depositAmount: state.depositAmount,
      escrowContract: state.escrowContract,
      opened: false,
      units: state.units,
    },
  };
}
