import { NextResponse, type NextRequest } from "next/server";
import { Credential, Errors, Method, z } from "mppx";
import { Mppx } from "mppx/server";
import { Methods } from "mppx/tempo";
import { type Address, type Hex, zeroAddress } from "viem";
import { waitForTransactionReceipt, writeContract } from "viem/actions";

import { megaethTestnet } from "@/lib/chain";
import {
  getMegaethSessionAuthorizedSigner,
  getOnChainMegaethSessionChannel,
  megaethSessionEscrowAbi,
  hydrateMegaethSessionChannelState,
  type MegaethSessionChannelState,
  computeMegaethSessionChannelId,
  validateMegaethSessionChannel,
  verifyMegaethSessionVoucher,
} from "@/lib/megaeth-session";
import {
  MPP_SESSION_DEPOSIT_AMOUNT_HUMAN,
  MPP_SESSION_ESCROW_CONTRACT,
  MPP_SESSION_REQUEST_AMOUNT_HUMAN,
  MPP_SESSION_TOKEN_ADDRESS,
  MPP_SESSION_TOKEN_DECIMALS,
  getMppSecretKey,
  getMppSessionPayToAddress,
  getMppSessionReadiness,
} from "@/lib/mpp-session-config";
import {
  assertOfficialMppSessionOpenNotReplayed,
  putOfficialMppSessionOpenChannelOnce,
} from "@/lib/mpp-session-open-replay";
import { getMppSessionStateStore } from "@/lib/mpp-session-store";
import {
  attachPaymentServerTiming,
  collectPaymentServerTiming,
  recordPaymentOnChainSegment,
} from "@/lib/payment-timing-server";
import { getRandomProtectedImage } from "@/lib/protected-image";
import {
  publicClient,
  getServerWallet,
  serverAccount,
} from "@/lib/server-wallet";

const sessionMethodWithTransactions = Method.from({
  name: Methods.session.name,
  intent: Methods.session.intent,
  schema: {
    credential: { payload: z.any() },
    request: Methods.session.schema.request,
  },
});

type MppxHandler = ReturnType<
  typeof Mppx.create<readonly [ReturnType<typeof Method.toServer>]>
>;
type MppxPaymentResult = {
  challenge: Response;
  status: number;
  withReceipt: (response: Response) => Response;
};

let cached: MppxHandler | null = null;
let cachedRealm: string | null = null;

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function assertSameAddress(actual: Address, expected: Address, label: string) {
  if (normalizeAddress(actual) !== normalizeAddress(expected)) {
    throw new Errors.VerificationFailedError({
      reason: `${label} ${actual} does not match expected ${expected}`,
    });
  }
}

function getPayloadAddress(
  payload: Record<string, unknown>,
  key: string,
): Address {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new Errors.VerificationFailedError({
      reason: `${key} is required`,
    });
  }
  return value as Address;
}

function getPayloadHex(payload: Record<string, unknown>, key: string): Hex {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new Errors.VerificationFailedError({
      reason: `${key} is required`,
    });
  }
  return value as Hex;
}

function getPayloadBigInt(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Errors.VerificationFailedError({
      reason: `${key} is required`,
    });
  }
  return BigInt(value);
}

function normalizeAuthorizedSigner(parameters: {
  authorizedSigner: Address;
  payer: Address;
}) {
  return parameters.authorizedSigner === zeroAddress
    ? parameters.payer
    : parameters.authorizedSigner;
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
      Method.toServer(sessionMethodWithTransactions, {
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
          const payload = credential.payload as Record<string, unknown>;
          const chainId =
            challenge.request.methodDetails?.chainId ?? megaethTestnet.id;
          const escrowContract =
            (challenge.request.methodDetails?.escrowContract as
              | Address
              | undefined) ?? MPP_SESSION_ESCROW_CONTRACT;
          const currency = challenge.request.currency as Address;
          const sessionRecipient = challenge.request.recipient as Address;
          const requestAmount = BigInt(challenge.request.amount);

          switch (payload.action) {
            case "open": {
              if (payload.type !== "transaction") {
                throw new Errors.VerificationFailedError({
                  reason: "session open requires transaction payload",
                });
              }

              const payer = getPayloadAddress(payload, "payer");
              const token = getPayloadAddress(payload, "token");
              const deposit = getPayloadBigInt(payload, "deposit");
              const salt = getPayloadHex(payload, "salt");
              const authorizedSigner = getPayloadAddress(
                payload,
                "authorizedSigner",
              );
              const cumulativeAmount = getPayloadBigInt(
                payload,
                "cumulativeAmount",
              );
              const channelId = getPayloadHex(payload, "channelId");
              const txHash =
                typeof payload.txHash === "string"
                  ? (payload.txHash as Hex)
                  : undefined;

              assertSameAddress(token, currency, "session open token");

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

              if (normalizeAddress(expectedChannelId) !== normalizeAddress(channelId)) {
                throw new Errors.VerificationFailedError({
                  reason: "claimed channelId does not match derived channelId",
                });
              }

              await assertOfficialMppSessionOpenNotReplayed({
                channelId,
                store: sessionStore,
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
              assertSameAddress(onChain.payer, payer, "on-chain payer");
              assertSameAddress(
                getMegaethSessionAuthorizedSigner(onChain),
                normalizeAuthorizedSigner({ authorizedSigner, payer }),
                "on-chain authorized signer",
              );

              if (onChain.deposit < deposit) {
                throw new Errors.VerificationFailedError({
                  reason: "on-chain deposit is below claimed session deposit",
                });
              }

              const isValid = await verifyMegaethSessionVoucher({
                chainId,
                escrowContract,
                expectedSigner: getMegaethSessionAuthorizedSigner(onChain),
                voucher: {
                  channelId,
                  cumulativeAmount,
                  signature: getPayloadHex(payload, "signature"),
                },
              });

              if (!isValid) {
                throw new Errors.VerificationFailedError({
                  reason: "invalid MegaETH session voucher signature for open",
                });
              }

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

              await putOfficialMppSessionOpenChannelOnce({
                channelId,
                state,
                store: sessionStore,
              });

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
                ...(txHash ? { txHash } : {}),
                units: state.units,
              };
            }

            case "voucher": {
              const channelId = getPayloadHex(payload, "channelId");
              const existing = await sessionStore.getChannel(channelId);

              if (!existing) {
                throw new Errors.VerificationFailedError({
                  reason: "session channel is not known to the server",
                });
              }

              const cumulativeAmount = getPayloadBigInt(
                payload,
                "cumulativeAmount",
              );
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
                  reason: `expected cumulativeAmount ${
                    existing.highestVoucherAmount + requestAmount
                  }, got ${cumulativeAmount}`,
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
                  signature: getPayloadHex(payload, "signature"),
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

              await sessionStore.putChannel(channelId, nextState);

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
              if (payload.type !== "transaction") {
                throw new Errors.VerificationFailedError({
                  reason: "session top-up requires transaction payload",
                });
              }

              const channelId = getPayloadHex(payload, "channelId");
              const existing = await sessionStore.getChannel(channelId);

              if (!existing) {
                throw new Errors.VerificationFailedError({
                  reason: "session channel is not known to the server",
                });
              }

              const additionalDeposit = getPayloadBigInt(
                payload,
                "additionalDeposit",
              );
              const txHash =
                typeof payload.txHash === "string"
                  ? (payload.txHash as Hex)
                  : undefined;

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

              if (onChain.deposit < existing.deposit + additionalDeposit) {
                throw new Errors.VerificationFailedError({
                  reason: "session top-up did not increase the on-chain deposit",
                });
              }

              const nextState = {
                ...existing,
                closeRequestedAt: onChain.closeRequestedAt,
                deposit: onChain.deposit,
                finalized: onChain.finalized,
                settledOnChain: onChain.settled,
              } satisfies MegaethSessionChannelState;

              await sessionStore.putChannel(channelId, nextState);

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
                ...(txHash ? { txHash } : {}),
                units: nextState.units,
              };
            }

            case "close": {
              const channelId = getPayloadHex(payload, "channelId");
              const existing = await sessionStore.getChannel(channelId);

              if (!existing) {
                throw new Errors.VerificationFailedError({
                  reason: "session channel is not known to the server",
                });
              }

              const cumulativeAmount = getPayloadBigInt(
                payload,
                "cumulativeAmount",
              );

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
              const signature = getPayloadHex(payload, "signature");
              const isValid = await verifyMegaethSessionVoucher({
                chainId,
                escrowContract,
                expectedSigner,
                voucher: {
                  channelId,
                  cumulativeAmount,
                  signature,
                },
              });

              if (!isValid) {
                throw new Errors.VerificationFailedError({
                  reason: "invalid MegaETH session close voucher signature",
                });
              }

              const closeStartedAt = performance.now();
              const closeHash = await writeContract(serverWalletClient, {
                abi: megaethSessionEscrowAbi,
                account: serverAccount,
                address: escrowContract,
                args: [channelId, cumulativeAmount, signature],
                functionName: "close",
              });

              await waitForTransactionReceipt(serverWalletClient, {
                hash: closeHash,
              });
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
                reason: `unknown session action: ${String(payload.action)}`,
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

function getSessionActionFromRequest(request: NextRequest): string | null {
  try {
    const credential = Credential.fromRequest(request);
    const payload = credential.payload as Record<string, unknown>;
    return typeof payload.action === "string" ? payload.action : null;
  } catch {
    return null;
  }
}

async function handle(request: NextRequest): Promise<Response> {
  const readiness = getMppSessionReadiness();
  if (!readiness.ready) {
    return NextResponse.json(
      {
        error: "MPP session route is not configured yet.",
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

  const action = getSessionActionFromRequest(request);
  const isManagementAction =
    request.method === "POST" && (action === "topUp" || action === "close");

  return attachPaymentServerTiming(
    result.withReceipt(
      NextResponse.json(
        isManagementAction
          ? {
              ok: true,
              route: "mpp/session",
              action,
              message: "MegaETH official-style session management accepted.",
              when: new Date().toISOString(),
            }
          : {
              ok: true,
              route: "mpp/session",
              message: "MegaETH official-style session payment accepted.",
              when: new Date().toISOString(),
              image: getRandomProtectedImage(),
            },
      ),
    ),
    timing,
  );
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
