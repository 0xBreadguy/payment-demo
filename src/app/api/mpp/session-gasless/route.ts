import { NextResponse, type NextRequest } from "next/server";
import { Errors, Method, z } from "mppx";
import { Mppx } from "mppx/server";
import { Methods } from "mppx/tempo";
import { parseSignature, type Address, type Hex } from "viem";
import { readContract } from "viem/actions";

import { megaethTestnet } from "@/lib/chain";
import { writeContractRealtime } from "@/lib/megaeth-realtime";
import { publicClient, getServerWallet, serverAccount } from "@/lib/server-wallet";
import { getRandomProtectedImage } from "@/lib/protected-image";
import {
  computeMegaethSessionChannelId,
  getMegaethSessionAuthorizedSigner,
  getOnChainMegaethSessionChannel,
  megaethSessionEscrowAbi,
  hydrateMegaethSessionChannelState,
  PERMIT2_ADDRESS,
  type MegaethSessionChannelState,
  recoverPermit2OpenSigner,
  recoverPermit2TopUpSigner,
  validateMegaethSessionChannel,
  verifyMegaethSessionVoucher,
} from "@/lib/megaeth-session";
import {
  MPP_SESSION_DEPOSIT_AMOUNT_HUMAN,
  MPP_SESSION_ESCROW_CONTRACT,
  MPP_SESSION_EXPLICIT_TOKEN_NAME,
  MPP_SESSION_EXPLICIT_TOKEN_VERSION,
  MPP_SESSION_REQUEST_AMOUNT_HUMAN,
  MPP_SESSION_TOKEN_ADDRESS,
  MPP_SESSION_TOKEN_DECIMALS,
  MPP_SESSION_TOKEN_NAME,
  MPP_SESSION_TOKEN_VERSION,
  getMppSecretKey,
  getMppSessionPayToAddress,
  getMppSessionReadiness,
} from "@/lib/mpp-session-config";
import {
  getMppSessionPermit20ApprovalIssue,
  recoverMppSessionPermit20ApprovalSigner,
  type MppSessionPermit20ApprovalPayload,
} from "@/lib/mpp-session-permit20-approval";
import { getMppSessionStateStore } from "@/lib/mpp-session-store";
import { putMppSessionTopUpChannelState } from "@/lib/mpp-session-top-up-race";
import { putMppSessionVoucherChannelOnce } from "@/lib/mpp-session-voucher-race";
import { permit20Erc20Abi, selectPermit20Domain } from "@/lib/mpp-permit20";
import {
  attachPaymentServerTiming,
  collectPaymentServerTiming,
  recordPaymentOnChainSegment,
} from "@/lib/payment-timing-server";

// Relax credential payload to accept the Permit2 variants of open/topUp.
const sessionMethodWithPermit2 = Method.from({
  name: Methods.session.name,
  intent: Methods.session.intent,
  schema: {
    credential: { payload: z.any() },
    request: Methods.session.schema.request,
  },
});

type MppxHandler = ReturnType<typeof Mppx.create<readonly [ReturnType<typeof Method.toServer>]>>;
type MppxPaymentResult = {
  challenge: Response;
  status: number;
  withReceipt: (response: Response) => Response;
};

let cached: MppxHandler | null = null;
let cachedRealm: string | null = null;
const cachedTokenDomains = new Map<
  string,
  { tokenName: string; tokenVersion: string }
>();

function normalizeAddress(value: Address) {
  return value.toLowerCase();
}

function assertSameAddress(actual: Address, expected: Address, label: string) {
  if (normalizeAddress(actual) !== normalizeAddress(expected)) {
    throw new Errors.VerificationFailedError({
      reason: `${label} ${actual} does not match expected ${expected}`,
    });
  }
}

function getRecoveryId(signature: Hex): number {
  const parsed = parseSignature(signature);
  const v =
    "v" in parsed && parsed.v !== undefined
      ? Number(parsed.v)
      : parsed.yParity + 27;
  if (v !== 27 && v !== 28) {
    throw new Errors.VerificationFailedError({
      reason: `unsupported permit20 signature v ${v}`,
    });
  }
  return v;
}

async function readSessionTokenDomain(token: Address) {
  try {
    const domain = await readContract(publicClient, {
      abi: permit20Erc20Abi,
      address: token,
      functionName: "eip712Domain",
    });
    const [, tokenDomainName, tokenDomainVersion] = domain as readonly [
      Hex,
      string,
      string,
      bigint,
      Address,
      Hex,
      readonly bigint[],
    ];
    return { tokenDomainName, tokenDomainVersion };
  } catch {
    try {
      const tokenDomainName = await readContract(publicClient, {
        abi: permit20Erc20Abi,
        address: token,
        functionName: "name",
      });
      return { tokenDomainName, tokenDomainVersion: undefined };
    } catch {
      return { tokenDomainName: undefined, tokenDomainVersion: undefined };
    }
  }
}

async function getSessionTokenDomain(token: Address) {
  const key = normalizeAddress(token);
  const cachedDomain = cachedTokenDomains.get(key);
  if (cachedDomain) return cachedDomain;

  const { tokenDomainName, tokenDomainVersion } =
    await readSessionTokenDomain(token);
  const selected = selectPermit20Domain({
    explicitName: MPP_SESSION_EXPLICIT_TOKEN_NAME,
    explicitVersion: MPP_SESSION_EXPLICIT_TOKEN_VERSION,
    fallbackName: MPP_SESSION_TOKEN_NAME,
    fallbackVersion: MPP_SESSION_TOKEN_VERSION,
    tokenDomainName,
    tokenDomainVersion,
  });
  cachedTokenDomains.set(key, selected);
  return selected;
}

async function readTokenAllowance(parameters: {
  owner: Address;
  token: Address;
}) {
  return readContract(publicClient, {
    abi: permit20Erc20Abi,
    address: parameters.token,
    args: [parameters.owner, PERMIT2_ADDRESS],
    functionName: "allowance",
  });
}

async function readTokenBalance(parameters: {
  owner: Address;
  token: Address;
}) {
  return readContract(publicClient, {
    abi: permit20Erc20Abi,
    address: parameters.token,
    args: [parameters.owner],
    functionName: "balanceOf",
  });
}

async function sponsorPermit20Approval(parameters: {
  approval: MppSessionPermit20ApprovalPayload | undefined;
  chainId: number;
  owner: Address;
  requiredValue: bigint;
  serverWalletClient: NonNullable<ReturnType<typeof getServerWallet>>;
  token: Address;
}): Promise<Hex> {
  const { approval, chainId, owner, requiredValue, serverWalletClient, token } =
    parameters;
  const issue = getMppSessionPermit20ApprovalIssue(approval, {
    expectedOwner: owner,
    nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
    requiredValue,
  });
  if (issue) {
    throw new Errors.VerificationFailedError({ reason: issue });
  }

  const payload = approval!;
  const tokenDomain = await getSessionTokenDomain(token);
  const recovered = await recoverMppSessionPermit20ApprovalSigner({
    chainId,
    payload,
    token,
    tokenName: tokenDomain.tokenName,
    tokenVersion: tokenDomain.tokenVersion,
  });
  assertSameAddress(recovered as Address, owner, "permit20 recovered signer");

  const [currentNonce, balance] = await Promise.all([
    readContract(publicClient, {
      abi: permit20Erc20Abi,
      address: token,
      args: [owner],
      functionName: "nonces",
    }),
    readTokenBalance({ owner, token }),
  ]);

  const payloadNonce = BigInt(payload.nonce);
  if (currentNonce !== payloadNonce) {
    throw new Errors.VerificationFailedError({
      reason: `permit20 nonce ${payloadNonce} does not match current token nonce ${currentNonce}`,
    });
  }

  if (balance < requiredValue) {
    throw new Errors.VerificationFailedError({
      reason: `owner USDm balance ${balance} is below required amount ${requiredValue}`,
    });
  }

  const { r, s } = parseSignature(payload.signature);
  const v = getRecoveryId(payload.signature);
  const permit20StartedAt = performance.now();
  const permitReceipt = await writeContractRealtime(serverWalletClient, {
    abi: permit20Erc20Abi,
    account: serverAccount!,
    address: token,
    args: [owner, PERMIT2_ADDRESS, requiredValue, BigInt(payload.deadline), v, r, s],
    functionName: "permit",
  });
  const permitHash = permitReceipt.transactionHash;
  recordPaymentOnChainSegment({
    durationMs: performance.now() - permit20StartedAt,
    hash: permitHash,
    label: "permit20 approval",
  });
  return permitHash;
}

async function ensureTokenAllowanceForPermit2(parameters: {
  approval: MppSessionPermit20ApprovalPayload | undefined;
  chainId: number;
  owner: Address;
  requiredValue: bigint;
  serverWalletClient: NonNullable<ReturnType<typeof getServerWallet>>;
  token: Address;
}) {
  const initialAllowance = await readTokenAllowance(parameters);
  if (initialAllowance >= parameters.requiredValue) {
    return {
      allowance: initialAllowance,
      permit20TxHash: undefined as Hex | undefined,
    };
  }

  const permit20TxHash = await sponsorPermit20Approval(parameters);
  const allowance = await readTokenAllowance(parameters);
  if (allowance < parameters.requiredValue) {
    throw new Errors.VerificationFailedError({
      reason: `Permit2 allowance ${allowance} < required ${parameters.requiredValue} after permit20 approval`,
    });
  }

  return { allowance, permit20TxHash };
}

function getMppx(realm: string): MppxHandler {
  if (cached && cachedRealm === realm) return cached;

  const secretKey = getMppSecretKey();
  const recipient = getMppSessionPayToAddress();
  const serverWalletClient = getServerWallet();
  const sessionStore = getMppSessionStateStore();

  if (!secretKey || !recipient || !serverWalletClient || !serverAccount) {
    throw new Error("MPP session route is not configured");
  }

  cached = Mppx.create({
    methods: [
      Method.toServer(sessionMethodWithPermit2, {
        defaults: {
          amount: MPP_SESSION_REQUEST_AMOUNT_HUMAN,
          chainId: megaethTestnet.id,
          currency: MPP_SESSION_TOKEN_ADDRESS,
          decimals: MPP_SESSION_TOKEN_DECIMALS,
          escrowContract: MPP_SESSION_ESCROW_CONTRACT,
          recipient,
          suggestedDeposit: MPP_SESSION_DEPOSIT_AMOUNT_HUMAN,
          unitType: "request",
        },
        async verify({ credential }) {
          const challenge = credential.challenge;
          const payload = credential.payload;
          const chainId =
            challenge.request.methodDetails?.chainId ?? megaethTestnet.id;
          const escrowContract =
            (challenge.request.methodDetails?.escrowContract as
              | Address
              | undefined) ?? MPP_SESSION_ESCROW_CONTRACT;
          const currency = challenge.request.currency as Address;
          const sessionRecipient = challenge.request.recipient as Address;
          const requestAmount = BigInt(challenge.request.amount);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = payload as Record<string, any>;

          switch (p.action) {
            case "open": {
              if (p.type !== "permit2") {
                throw new Errors.VerificationFailedError({
                  reason: "session open requires permit2 payload",
                });
              }

              const payer = p.payer as Address;
              const token = p.token as Address;
              const deposit = BigInt(p.deposit);
              const salt = p.salt as Hex;
              const authorizedSigner = p.authorizedSigner as Address;
              const permit2Nonce = BigInt(p.permit2Nonce);
              const permit2Deadline = BigInt(p.permit2Deadline);
              const permit2Signature = p.permit2Signature as Hex;
              const cumulativeAmount = BigInt(p.cumulativeAmount);
              const channelId = p.channelId as Hex;

              if (token.toLowerCase() !== currency.toLowerCase()) {
                throw new Errors.VerificationFailedError({
                  reason:
                    "session open token does not match the route currency",
                });
              }

              if (deposit < requestAmount) {
                throw new Errors.VerificationFailedError({
                  reason:
                    "session channel deposit is below the first request amount",
                });
              }

              if (cumulativeAmount !== requestAmount) {
                throw new Errors.VerificationFailedError({
                  reason:
                    "the first session voucher must match exactly one request amount",
                });
              }

              const expectedChannelId = computeMegaethSessionChannelId({
                authorizedSigner,
                chainId,
                escrowContract,
                payee: sessionRecipient,
                payer,
                salt,
                token,
              });

              if (
                expectedChannelId.toLowerCase() !== channelId.toLowerCase()
              ) {
                throw new Errors.VerificationFailedError({
                  reason: "claimed channelId does not match derived channelId",
                });
              }

              const isValid = await verifyMegaethSessionVoucher({
                chainId,
                escrowContract,
                expectedSigner: authorizedSigner,
                voucher: {
                  channelId,
                  cumulativeAmount,
                  signature: p.signature as Hex,
                },
              });

              if (!isValid) {
                throw new Errors.VerificationFailedError({
                  reason: "invalid MegaETH session voucher signature for open",
                });
              }

              const openArgs = [
                payer,
                sessionRecipient,
                token,
                deposit,
                salt,
                authorizedSigner,
                permit2Nonce,
                permit2Deadline,
                permit2Signature,
              ] as const;

              // Pre-flight check: payer's balance and Permit2 allowance.
              const payerBalance = await readTokenBalance({
                owner: payer,
                token,
              });
              const serverRecoveredSigner = await recoverPermit2OpenSigner({
                amount: deposit,
                authorizedSigner,
                chainId,
                deadline: permit2Deadline,
                nonce: permit2Nonce,
                payee: sessionRecipient,
                salt,
                signature: permit2Signature,
                spender: escrowContract,
                token,
              });
              if (
                serverRecoveredSigner.toLowerCase() !== payer.toLowerCase()
              ) {
                throw new Errors.VerificationFailedError({
                  reason: `Permit2 signature recovers to ${serverRecoveredSigner} on server, expected payer ${payer}. Wallet/digest mismatch.`,
                });
              }

              if (payerBalance < deposit) {
                throw new Errors.VerificationFailedError({
                  reason: `Payer USDm balance ${payerBalance} < deposit ${deposit}`,
                });
              }

              const { permit20TxHash } =
                await ensureTokenAllowanceForPermit2({
                  approval: p.permit20Approval as
                    | MppSessionPermit20ApprovalPayload
                    | undefined,
                  chainId,
                  owner: payer,
                  requiredValue: deposit,
                  serverWalletClient,
                  token,
                });

              const openStartedAt = performance.now();
              const openReceipt = await writeContractRealtime(serverWalletClient, {
                abi: megaethSessionEscrowAbi,
                account: serverAccount,
                address: escrowContract,
                args: openArgs,
                functionName: "openWithPermit2",
              });
              const openHash = openReceipt.transactionHash;
              recordPaymentOnChainSegment({
                durationMs: performance.now() - openStartedAt,
                hash: openHash,
                label: "openWithPermit2",
              });

              const onChain = await getOnChainMegaethSessionChannel(
                publicClient,
                escrowContract,
                channelId,
              );
              validateMegaethSessionChannel({
                currency,
                onChain,
                recipient: sessionRecipient,
              });

              const state = {
                ...hydrateMegaethSessionChannelState({
                  chainId,
                  channelId,
                  escrowContract,
                  onChain,
                }),
                highestVoucherAmount: cumulativeAmount,
                spent: cumulativeAmount,
                units: 1,
              } satisfies MegaethSessionChannelState;

              await sessionStore.putChannel(channelId, state);

              return {
                acceptedCumulative: state.highestVoucherAmount.toString(),
                challengeId: challenge.id,
                channelId,
                intent: "session" as const,
                method: "tempo" as const,
                reference: channelId,
                spent: state.spent.toString(),
                status: "success" as const,
                timestamp: new Date().toISOString(),
                ...(permit20TxHash ? { permit20TxHash } : {}),
                txHash: openHash,
                units: state.units,
              };
            }

            case "voucher": {
              const channelId = p.channelId as Hex;
              const existing = await sessionStore.getChannel(channelId);

              if (!existing) {
                throw new Errors.VerificationFailedError({
                  reason: "session channel is not known to the server",
                });
              }
              const expectedHighestVoucherAmount =
                existing.highestVoucherAmount;

              const cumulativeAmount = BigInt(p.cumulativeAmount);
              const onChain = await getOnChainMegaethSessionChannel(
                publicClient,
                escrowContract,
                channelId,
              );
              validateMegaethSessionChannel({
                currency,
                onChain,
                recipient: sessionRecipient,
              });

              if (
                cumulativeAmount !==
                existing.highestVoucherAmount + requestAmount
              ) {
                throw new Errors.VerificationFailedError({
                  reason: `expected cumulativeAmount ${existing.highestVoucherAmount + requestAmount}, got ${cumulativeAmount}`,
                });
              }

              if (cumulativeAmount > onChain.deposit) {
                throw new Errors.VerificationFailedError({
                  reason: "voucher amount exceeds on-chain deposit",
                });
              }

              const expectedSigner = getMegaethSessionAuthorizedSigner(onChain);
              const isValid = await verifyMegaethSessionVoucher({
                chainId,
                escrowContract,
                expectedSigner,
                voucher: {
                  channelId,
                  cumulativeAmount,
                  signature: p.signature as Hex,
                },
              });

              if (!isValid) {
                throw new Errors.VerificationFailedError({
                  reason: "invalid MegaETH session voucher signature",
                });
              }

              const nextState = {
                ...existing,
                authorizedSigner: expectedSigner,
                closeRequestedAt: onChain.closeRequestedAt,
                deposit: onChain.deposit,
                finalized: onChain.finalized,
                highestVoucherAmount: cumulativeAmount,
                settledOnChain: onChain.settled,
                spent: cumulativeAmount,
                units: existing.units + 1,
              } satisfies MegaethSessionChannelState;

              await putMppSessionVoucherChannelOnce({
                channelId,
                expectedHighestVoucherAmount,
                state: nextState,
                store: sessionStore,
              });

              return {
                acceptedCumulative: nextState.highestVoucherAmount.toString(),
                challengeId: challenge.id,
                channelId,
                intent: "session" as const,
                method: "tempo" as const,
                reference: channelId,
                spent: nextState.spent.toString(),
                status: "success" as const,
                timestamp: new Date().toISOString(),
                units: nextState.units,
              };
            }

            case "topUp": {
              const channelId = p.channelId as Hex;
              const existing = await sessionStore.getChannel(channelId);

              if (!existing) {
                throw new Errors.VerificationFailedError({
                  reason: "session channel is not known to the server",
                });
              }

              if (p.type !== "permit2") {
                throw new Errors.VerificationFailedError({
                  reason: "session top-up requires permit2 payload",
                });
              }

              const additionalDeposit = BigInt(p.additionalDeposit);
              const permit2Nonce = BigInt(p.permit2Nonce);
              const permit2Deadline = BigInt(p.permit2Deadline);
              const permit2Signature = p.permit2Signature as Hex;

              const recoveredTopUpSigner = await recoverPermit2TopUpSigner({
                amount: additionalDeposit,
                chainId,
                channelId,
                deadline: permit2Deadline,
                nonce: permit2Nonce,
                signature: permit2Signature,
                spender: escrowContract,
                token: existing.token,
              });
              if (
                recoveredTopUpSigner.toLowerCase() !==
                existing.payer.toLowerCase()
              ) {
                throw new Errors.VerificationFailedError({
                  reason: "invalid MegaETH session top-up permit2 signature",
                });
              }

              const payerBalance = await readTokenBalance({
                owner: existing.payer,
                token: existing.token,
              });
              if (payerBalance < additionalDeposit) {
                throw new Errors.VerificationFailedError({
                  reason: `Payer USDm balance ${payerBalance} < top-up amount ${additionalDeposit}`,
                });
              }

              const { permit20TxHash } =
                await ensureTokenAllowanceForPermit2({
                  approval: p.permit20Approval as
                    | MppSessionPermit20ApprovalPayload
                    | undefined,
                  chainId,
                  owner: existing.payer,
                  requiredValue: additionalDeposit,
                  serverWalletClient,
                  token: existing.token,
                });

              const topUpStartedAt = performance.now();
              const topUpReceipt = await writeContractRealtime(serverWalletClient, {
                abi: megaethSessionEscrowAbi,
                account: serverAccount,
                address: escrowContract,
                args: [
                  channelId,
                  additionalDeposit,
                  permit2Nonce,
                  permit2Deadline,
                  permit2Signature,
                ],
                functionName: "topUpWithPermit2",
              });
              const topUpHash = topUpReceipt.transactionHash;
              recordPaymentOnChainSegment({
                durationMs: performance.now() - topUpStartedAt,
                hash: topUpHash,
                label: "topUpWithPermit2",
              });

              const onChain = await getOnChainMegaethSessionChannel(
                publicClient,
                escrowContract,
                channelId,
              );
              validateMegaethSessionChannel({
                currency,
                onChain,
                recipient: sessionRecipient,
              });

              if (onChain.deposit <= existing.deposit) {
                throw new Errors.VerificationFailedError({
                  reason:
                    "session top-up did not increase the on-chain deposit",
                });
              }

              const nextState = await putMppSessionTopUpChannelState({
                channelId,
                onChain: {
                  closeRequestedAt: onChain.closeRequestedAt,
                  deposit: onChain.deposit,
                  finalized: onChain.finalized,
                  settledOnChain: onChain.settled,
                },
                store: sessionStore,
              });

              return {
                acceptedCumulative: nextState.highestVoucherAmount.toString(),
                challengeId: challenge.id,
                channelId,
                intent: "session" as const,
                method: "tempo" as const,
                reference: channelId,
                spent: nextState.spent.toString(),
                status: "success" as const,
                timestamp: new Date().toISOString(),
                ...(permit20TxHash ? { permit20TxHash } : {}),
                txHash: topUpHash,
                units: nextState.units,
              };
            }

            case "close": {
              const channelId = p.channelId as Hex;
              const existing = await sessionStore.getChannel(channelId);

              if (!existing) {
                throw new Errors.VerificationFailedError({
                  reason: "session channel is not known to the server",
                });
              }

              const cumulativeAmount = BigInt(p.cumulativeAmount);

              if (cumulativeAmount !== existing.highestVoucherAmount) {
                throw new Errors.VerificationFailedError({
                  reason:
                    "session close must use the highest accepted cumulative amount",
                });
              }

              const onChain = await getOnChainMegaethSessionChannel(
                publicClient,
                escrowContract,
                channelId,
              );
              validateMegaethSessionChannel({
                currency,
                onChain,
                recipient: sessionRecipient,
              });

              const expectedSigner = getMegaethSessionAuthorizedSigner(onChain);
              const isValid = await verifyMegaethSessionVoucher({
                chainId,
                escrowContract,
                expectedSigner,
                voucher: {
                  channelId,
                  cumulativeAmount,
                  signature: p.signature as Hex,
                },
              });

              if (!isValid) {
                throw new Errors.VerificationFailedError({
                  reason: "invalid MegaETH session close voucher signature",
                });
              }

              const closeStartedAt = performance.now();
              const closeReceipt = await writeContractRealtime(serverWalletClient, {
                abi: megaethSessionEscrowAbi,
                account: serverAccount,
                address: escrowContract,
                args: [channelId, cumulativeAmount, p.signature as Hex],
                functionName: "close",
              });
              const closeHash = closeReceipt.transactionHash;
              recordPaymentOnChainSegment({
                durationMs: performance.now() - closeStartedAt,
                hash: closeHash,
                label: "close",
              });

              const closedChannel = await getOnChainMegaethSessionChannel(
                publicClient,
                escrowContract,
                channelId,
              );

              if (!closedChannel.finalized) {
                throw new Errors.VerificationFailedError({
                  reason:
                    "session close transaction did not finalize the channel",
                });
              }

              await sessionStore.deleteChannel(channelId);

              return {
                acceptedCumulative: cumulativeAmount.toString(),
                challengeId: challenge.id,
                channelId,
                intent: "session" as const,
                method: "tempo" as const,
                reference: channelId,
                spent: cumulativeAmount.toString(),
                status: "success" as const,
                timestamp: new Date().toISOString(),
                txHash: closeHash,
                units: existing.units,
              };
            }

            default:
              throw new Errors.VerificationFailedError({
                reason: `unknown session action: ${String(p.action)}`,
              });
          }
        },
      }),
    ],
    realm,
    secretKey,
  }) as unknown as MppxHandler;

  cachedRealm = realm;
  return cached;
}

async function handle(request: NextRequest): Promise<Response> {
  const readiness = getMppSessionReadiness();
  if (!readiness.ready) {
    return NextResponse.json(
      {
        error: "MPP session gasless route is not configured yet.",
        missingEnv: readiness.missingEnv,
      },
      { status: 503 },
    );
  }

  const realm = new URL(request.url).host;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mppx = getMppx(realm) as any;
  const { timing, value: result } =
    await collectPaymentServerTiming<MppxPaymentResult>(() =>
      mppx.tempo.session({})(request),
    );

  if (result.status === 402) {
    return result.challenge;
  }

  return attachPaymentServerTiming(
    result.withReceipt(
      NextResponse.json({
        ok: true,
        route: "mpp/session-gasless",
        message: "MegaETH gasless session payment accepted.",
        when: new Date().toISOString(),
        image: getRandomProtectedImage(),
      }),
    ),
    timing,
  );
}

export async function GET() {
  return NextResponse.json(
    { error: "MPP session payments must use POST." },
    {
      headers: { Allow: "POST" },
      status: 405,
    },
  );
}

export async function POST(request: NextRequest) {
  return handle(request);
}
