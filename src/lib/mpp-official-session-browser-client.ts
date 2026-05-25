import {
  encodeFunctionData,
  formatUnits,
  numberToHex,
  parseUnits,
  toHex,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { Challenge, Credential } from "mppx";
import { megaethTestnet, megaethTxUrl } from "./chain.ts";
import { getMppSessionCloseRefundAmount } from "./mpp-session-feed.ts";
import {
  computeMegaethSessionChannelId,
  createMegaethSessionSource,
  getMegaethErc20Allowance,
  getMegaethErc20Balance,
  getMegaethSessionPaymentPlan,
  megaethErc20Abi,
  megaethSessionEscrowAbi,
  signMegaethSessionVoucher,
} from "./megaeth-session.ts";
import {
  mergePaymentTiming,
  readServerPaymentTiming,
  type PaymentTiming,
  type PaymentTimingChainSegment,
} from "./payment-timing.ts";
import { USDM_DECIMALS, USDM_SYMBOL } from "./usdm.ts";

export const getMppOfficialSessionPaymentPlan = getMegaethSessionPaymentPlan;

export type MppOfficialSessionProgressStep =
  | "requesting"
  | "checking-allowance"
  | "approving"
  | "opening"
  | "topping-up"
  | "signing-voucher"
  | "submitting"
  | "waiting-tx"
  | "done";

export type MppOfficialSessionProgress = {
  step: MppOfficialSessionProgressStep;
};

export type MppOfficialSessionLocalState = {
  channelId?: Hex;
  cumulativeAmount?: bigint;
  depositAmount?: bigint;
  escrowContract?: Address;
  opened: boolean;
  units: number;
};

export type MppOfficialSessionReceipt = {
  acceptedCumulative: string;
  channelId: string;
  challengeId: string;
  spent: string;
  txHash?: string;
  units?: number;
};

export type MppOfficialSessionRequestResult = {
  status: number;
  body: unknown;
  receipt: MppOfficialSessionReceipt;
  rawReceipt: Record<string, unknown>;
  timing: PaymentTiming;
  action: "open" | "voucher";
  txHash?: `0x${string}`;
  explorerUrl?: string;
};

export type MppOfficialSessionTopUpResult = {
  status: number;
  receipt: MppOfficialSessionReceipt;
  rawReceipt: Record<string, unknown>;
  additionalDeposit: string;
  timing: PaymentTiming;
  txHash: `0x${string}`;
  explorerUrl: string;
};

export type MppOfficialSessionCloseResult = {
  status: number;
  receipt: MppOfficialSessionReceipt;
  rawReceipt: Record<string, unknown>;
  refundAmount: string;
  timing: PaymentTiming;
  txHash: `0x${string}`;
  explorerUrl: string;
};

export type MppOfficialSessionOptions = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  targetUrl: string;
  configuredDepositHuman: string;
  state: MppOfficialSessionLocalState;
  onProgress?: (p: MppOfficialSessionProgress) => void;
};

const WALLET_TX_HASH_TIMEOUT_MS = 120_000;

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

function isWalletSendTransactionUnsupported(error: unknown) {
  if (!(error instanceof Error)) return false;
  const maybeRpcError = error as Error & { code?: number };
  return (
    maybeRpcError.code === -32601 ||
    error.name === "InvalidInputRpcError" ||
    error.name === "InvalidParamsRpcError" ||
    error.name === "MethodNotFoundRpcError" ||
    error.name === "MethodNotSupportedRpcError" ||
    /wallet_sendTransaction.*(not found|not supported|unsupported)/i.test(
      error.message,
    )
  );
}

async function withWalletTxHashTimeout(
  promise: Promise<Hex>,
  label: string,
  timeoutMs = WALLET_TX_HASH_TIMEOUT_MS,
): Promise<Hex> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Hex>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `${label} was submitted to the wallet, but the wallet did not return a transaction hash. Check wallet activity or the explorer before retrying to avoid sending a duplicate transaction.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function sendMppOfficialSessionWalletContractTransaction<
  const abi extends Abi,
  functionName extends ContractFunctionName<
    abi,
    "nonpayable" | "payable"
  >,
>(options: {
  abi: abi;
  account: Address;
  address: Address;
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>;
  functionName: functionName;
  label: string;
  walletClient: WalletClient;
  walletResponseTimeoutMs?: number;
}): Promise<Hex> {
  const {
    abi,
    account,
    address,
    args,
    functionName,
    label,
    walletClient,
    walletResponseTimeoutMs,
  } = options;
  const data = encodeFunctionData({
    abi,
    args,
    functionName,
  } as Parameters<typeof encodeFunctionData>[0]);
  const request = {
    chainId: numberToHex(megaethTestnet.id),
    data,
    from: account,
    to: address,
  };

  try {
    const hash = walletClient.request({
      method: "wallet_sendTransaction",
      params: [request],
    } as Parameters<WalletClient["request"]>[0]) as Promise<Hex>;
    return await withWalletTxHashTimeout(hash, label, walletResponseTimeoutMs);
  } catch (error) {
    if (!isWalletSendTransactionUnsupported(error)) throw error;
  }

  return withWalletTxHashTimeout(
    walletClient.writeContract({
      abi,
      account,
      address,
      args,
      chain: megaethTestnet,
      functionName,
    } as Parameters<WalletClient["writeContract"]>[0]),
    label,
    walletResponseTimeoutMs,
  );
}

function decodeRawReceiptHeader(response: Response): Record<string, unknown> {
  const header = response.headers.get("Payment-Receipt");
  if (!header) throw new Error("Missing Payment-Receipt header.");
  const json = atob(header.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as Record<string, unknown>;
}

function buildSessionReceipt(
  raw: Record<string, unknown>,
): MppOfficialSessionReceipt {
  return {
    acceptedCumulative: String(raw.acceptedCumulative ?? "0"),
    channelId: String(raw.channelId ?? ""),
    challengeId: String(raw.challengeId ?? ""),
    spent: String(raw.spent ?? "0"),
    txHash: raw.txHash ? String(raw.txHash) : undefined,
    units: typeof raw.units === "number" ? raw.units : undefined,
  };
}

function buildPaymentTiming(parameters: {
  chainSegments: PaymentTimingChainSegment[];
  response: Response;
  startedAt: number;
}) {
  const { chainSegments, response, startedAt } = parameters;
  const onChainMs = chainSegments.reduce(
    (total, segment) => total + segment.durationMs,
    0,
  );
  return mergePaymentTiming({
    client: {
      ...(chainSegments.length > 0
        ? { chainSegments, chainSide: "client" as const, onChainMs }
        : { chainSide: "none" as const }),
      totalMs: performance.now() - startedAt,
    },
    server: readServerPaymentTiming(response.headers),
  });
}

async function ensureEscrowAllowance(options: {
  account: Address;
  amount: bigint;
  chainSegments: PaymentTimingChainSegment[];
  escrowContract: Address;
  publicClient: PublicClient;
  token: Address;
  walletClient: WalletClient;
  onProgress?: (p: MppOfficialSessionProgress) => void;
}) {
  const {
    account,
    amount,
    chainSegments,
    escrowContract,
    publicClient,
    token,
    walletClient,
    onProgress,
  } = options;

  onProgress?.({ step: "checking-allowance" });
  const allowance = await getMegaethErc20Allowance(
    publicClient,
    token,
    account,
    escrowContract,
  );
  if (allowance >= amount) return;

  onProgress?.({ step: "approving" });
  const startedAt = performance.now();
  const hash = await walletClient.writeContract({
    abi: megaethErc20Abi,
    account,
    address: token,
    args: [escrowContract, amount],
    chain: megaethTestnet,
    functionName: "approve",
  });

  onProgress?.({ step: "waiting-tx" });
  await publicClient.waitForTransactionReceipt({ hash });
  chainSegments.push({
    durationMs: performance.now() - startedAt,
    hash,
    label: `approve ${formatUnits(amount, USDM_DECIMALS)} ${USDM_SYMBOL}`,
  });
}

export async function payMppOfficialSessionRequest(
  options: MppOfficialSessionOptions,
): Promise<{
  result: MppOfficialSessionRequestResult;
  nextState: MppOfficialSessionLocalState;
}> {
  const {
    walletClient,
    publicClient,
    account,
    targetUrl,
    configuredDepositHuman,
    state,
    onProgress,
  } = options;

  const totalStartedAt = performance.now();
  const chainSegments: PaymentTimingChainSegment[] = [];

  onProgress?.({ step: "requesting" });
  const initial = await fetch(targetUrl);
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

  const plan = getMppOfficialSessionPaymentPlan({
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
      `MPP session balance is too low. Top up ${configuredDepositHuman} ${USDM_SYMBOL} before signing another pay voucher.`,
    );
  }

  let action: "open" | "voucher" = "voucher";
  let credential: string;
  let nextState: MppOfficialSessionLocalState = state;

  if (plan.action === "open") {
    action = "open";

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

    await ensureEscrowAllowance({
      account,
      amount: plan.depositAmount,
      chainSegments,
      escrowContract,
      publicClient,
      token: currency,
      walletClient,
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

    onProgress?.({ step: "opening" });
    const openStartedAt = performance.now();
    const openHash = await walletClient.writeContract({
      abi: megaethSessionEscrowAbi,
      account,
      address: escrowContract,
      args: [recipient, currency, plan.depositAmount, salt, account],
      chain: megaethTestnet,
      functionName: "open",
    });

    onProgress?.({ step: "waiting-tx" });
    await publicClient.waitForTransactionReceipt({ hash: openHash });
    chainSegments.push({
      durationMs: performance.now() - openStartedAt,
      hash: openHash,
      label: "open",
    });

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
        salt,
        signature,
        token: currency,
        txHash: openHash,
        type: "transaction",
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
  const finalResponse = await fetch(targetUrl, {
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
  const timing = buildPaymentTiming({
    chainSegments,
    response: finalResponse,
    startedAt: totalStartedAt,
  });

  const txHash =
    action === "open"
      ? (receipt.txHash as `0x${string}` | undefined)
      : undefined;
  const explorerUrl =
    action === "open" && txHash ? megaethTxUrl(txHash) : undefined;

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

export async function topUpMppOfficialSession(
  options: MppOfficialSessionOptions,
): Promise<{
  result: MppOfficialSessionTopUpResult;
  nextState: MppOfficialSessionLocalState;
}> {
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

  const totalStartedAt = performance.now();
  const chainSegments: PaymentTimingChainSegment[] = [];
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

  await ensureEscrowAllowance({
    account,
    amount: additionalDeposit,
    chainSegments,
    escrowContract,
    publicClient,
    token: currency,
    walletClient,
    onProgress,
  });

  onProgress?.({ step: "topping-up" });
  const topUpStartedAt = performance.now();
  const topUpHash = await sendMppOfficialSessionWalletContractTransaction({
    abi: megaethSessionEscrowAbi,
    account,
    address: escrowContract,
    args: [state.channelId, additionalDeposit],
    functionName: "topUp",
    label: "topUp",
    walletClient,
  });

  onProgress?.({ step: "waiting-tx" });
  await publicClient.waitForTransactionReceipt({ hash: topUpHash });
  chainSegments.push({
    durationMs: performance.now() - topUpStartedAt,
    hash: topUpHash,
    label: "topUp",
  });

  const credential = Credential.serialize({
    challenge,
    payload: {
      action: "topUp",
      additionalDeposit: additionalDeposit.toString(),
      channelId: state.channelId,
      txHash: topUpHash,
      type: "transaction",
    },
    source: createMegaethSessionSource(chainId, account),
  });

  onProgress?.({ step: "submitting" });
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
  const timing = buildPaymentTiming({
    chainSegments,
    response,
    startedAt: totalStartedAt,
  });

  onProgress?.({ step: "done" });

  return {
    result: {
      additionalDeposit: additionalDeposit.toString(),
      explorerUrl: megaethTxUrl(topUpHash),
      rawReceipt,
      receipt,
      status: response.status,
      timing,
      txHash: topUpHash,
    },
    nextState: {
      ...state,
      depositAmount: state.depositAmount + additionalDeposit,
      escrowContract,
      opened: true,
    },
  };
}

export async function closeMppOfficialSession(options: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  targetUrl: string;
  state: MppOfficialSessionLocalState;
  onProgress?: (p: MppOfficialSessionProgress) => void;
}): Promise<{
  result: MppOfficialSessionCloseResult;
  nextState: MppOfficialSessionLocalState;
}> {
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

  const totalStartedAt = performance.now();

  onProgress?.({ step: "requesting" });
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
  const timing = buildPaymentTiming({
    chainSegments: [],
    response,
    startedAt: totalStartedAt,
  });

  onProgress?.({ step: "done" });

  return {
    result: {
      explorerUrl: megaethTxUrl(txHash),
      rawReceipt,
      receipt,
      refundAmount: getMppSessionCloseRefundAmount(
        state.depositAmount,
        BigInt(receipt.acceptedCumulative),
      ),
      status: response.status,
      timing,
      txHash,
    },
    nextState: {
      opened: false,
      units: 0,
    },
  };
}
