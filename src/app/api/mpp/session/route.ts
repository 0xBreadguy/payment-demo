import { NextResponse, type NextRequest } from "next/server";
import { Credential, Errors, Method } from "mppx";
import { Mppx } from "mppx/server";
import {
  decodeFunctionData,
  getAddress,
  type Address,
  type Hex,
  zeroAddress,
} from "viem";

import { megaethTestnet } from "@/lib/chain";
import { evmSessionMethod } from "@/lib/mpp-evm-session-method";
import { writeContractRealtime } from "@/lib/megaeth-realtime";
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
  MPP_SESSION_DEPOSIT_AMOUNT_BASE_UNITS,
  MPP_SESSION_ESCROW_CONTRACT,
  MPP_SESSION_REQUEST_AMOUNT_BASE_UNITS,
  MPP_SESSION_TOKEN_ADDRESS,
  getMppSecretKey,
  getMppSessionPayToAddress,
  getMppSessionReadiness,
} from "@/lib/mpp-session-config";
import {
  assertOfficialMppSessionOpenNotReplayed,
  putOfficialMppSessionOpenChannelOnce,
} from "@/lib/mpp-session-open-replay";
import { getMppSessionStateStore } from "@/lib/mpp-session-store";
import { putMppSessionTopUpChannelState } from "@/lib/mpp-session-top-up-race";
import { putMppSessionVoucherChannelOnce } from "@/lib/mpp-session-voucher-race";
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

function getCredentialSourceAddress(
  credential: { source?: string },
  expectedChainId: number,
): Address {
  const match = credential.source?.match(/^did:pkh:eip155:(\d+):(0x[0-9a-fA-F]{40})$/u);
  if (!match) {
    throw new Errors.VerificationFailedError({
      reason: "credential source must be did:pkh:eip155:<chainId>:<payer>",
    });
  }
  const [, chainId, address] = match;
  if (Number(chainId) !== expectedChainId) {
    throw new Errors.VerificationFailedError({
      reason: `credential source chainId ${chainId} does not match expected ${expectedChainId}`,
    });
  }
  return getAddress(address);
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

async function verifyDirectEscrowTransaction(parameters: {
  escrowContract: Address;
  expectedFrom: Address;
  expectedFunctionName: "open" | "topUp";
  hash: Hex;
}) {
  const { escrowContract, expectedFrom, expectedFunctionName, hash } =
    parameters;
  const [transaction, receipt] = await Promise.all([
    publicClient.getTransaction({ hash }),
    publicClient.getTransactionReceipt({ hash }),
  ]);

  if (receipt.status !== "success") {
    throw new Errors.VerificationFailedError({
      reason: `session ${expectedFunctionName} transaction ${hash} did not succeed`,
    });
  }
  if (!transaction.to) {
    throw new Errors.VerificationFailedError({
      reason: `session ${expectedFunctionName} transaction ${hash} has no direct target`,
    });
  }
  assertSameAddress(transaction.to, escrowContract, "session transaction target");
  assertSameAddress(
    transaction.from,
    expectedFrom,
    "session transaction sender",
  );

  const decoded = decodeFunctionData({
    abi: megaethSessionEscrowAbi,
    data: transaction.input,
  });
  if (decoded.functionName !== expectedFunctionName) {
    throw new Errors.VerificationFailedError({
      reason: `session transaction called ${decoded.functionName}, expected ${expectedFunctionName}`,
    });
  }

  return decoded.args;
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
      Method.toServer(evmSessionMethod, {
        defaults: {
          amount: MPP_SESSION_REQUEST_AMOUNT_BASE_UNITS,
          currency: MPP_SESSION_TOKEN_ADDRESS,
          recipient,
          suggestedDeposit: MPP_SESSION_DEPOSIT_AMOUNT_BASE_UNITS,
          unitType: "request",
          methodDetails: {
            chainId: megaethTestnet.id,
            credentialTypes: ["hash"],
            escrowContract: MPP_SESSION_ESCROW_CONTRACT,
            feePayer: false,
          },
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
              if (payload.type !== "hash") {
                throw new Errors.VerificationFailedError({
                  reason: "session open requires hash payload",
                });
              }

              const payer = getCredentialSourceAddress(credential, chainId);
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
              const txHash = getPayloadHex(payload, "hash");

              const openArgs = await verifyDirectEscrowTransaction({
                escrowContract,
                expectedFrom: payer,
                expectedFunctionName: "open",
                hash: txHash,
              });
              const [
                txPayee,
                token,
                deposit,
                txSalt,
                txAuthorizedSigner,
              ] = openArgs as readonly [Address, Address, bigint, Hex, Address];

              assertSameAddress(token, currency, "session open token");
              assertSameAddress(txPayee, sessionRecipient, "session open payee");
              assertSameAddress(
                txAuthorizedSigner,
                authorizedSigner,
                "session open authorized signer",
              );
              if (txSalt.toLowerCase() !== salt.toLowerCase()) {
                throw new Errors.VerificationFailedError({
                  reason: "session open salt does not match transaction input",
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
                method: "evm" as const,
                reference: channelId,
                spent: state.spent.toString(),
                status: "success" as const,
                timestamp: new Date().toISOString(),
                ...(txHash ? { txHash } : {}),
                chainId,
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
              const expectedHighestVoucherAmount =
                existing.highestVoucherAmount;

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

              if (cumulativeAmount <= existing.highestVoucherAmount) {
                return {
                  acceptedCumulative:
                    existing.highestVoucherAmount.toString(),
                  challengeId: challenge.id,
                  channelId,
                  chainId,
                  intent: "session" as const,
                  method: "evm" as const,
                  reference: channelId,
                  spent: existing.spent.toString(),
                  status: "success" as const,
                  timestamp: new Date().toISOString(),
                  units: existing.units,
                };
              }

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
                chainId,
                intent: "session" as const,
                method: "evm" as const,
                reference: channelId,
                spent: nextState.spent.toString(),
                status: "success" as const,
                timestamp: new Date().toISOString(),
                units: nextState.units,
              };
            }

            case "topUp": {
              if (payload.type !== "hash") {
                throw new Errors.VerificationFailedError({
                  reason: "session top-up requires hash payload",
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
              const txHash = getPayloadHex(payload, "hash");
              const payer = getCredentialSourceAddress(credential, chainId);
              assertSameAddress(payer, existing.payer, "session top-up payer");

              const topUpArgs = await verifyDirectEscrowTransaction({
                escrowContract,
                expectedFrom: existing.payer,
                expectedFunctionName: "topUp",
                hash: txHash,
              });
              const [txChannelId, txAdditionalDeposit] = topUpArgs as readonly [
                Hex,
                bigint,
              ];
              if (txChannelId.toLowerCase() !== channelId.toLowerCase()) {
                throw new Errors.VerificationFailedError({
                  reason: "session top-up channelId does not match transaction input",
                });
              }
              if (txAdditionalDeposit !== additionalDeposit) {
                throw new Errors.VerificationFailedError({
                  reason:
                    "session top-up amount does not match transaction input",
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

              if (onChain.deposit !== existing.deposit + additionalDeposit) {
                throw new Errors.VerificationFailedError({
                  reason: "session top-up did not increase the on-chain deposit",
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
                chainId,
                intent: "session" as const,
                method: "evm" as const,
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
              const closeReceipt = await writeContractRealtime(serverWalletClient, {
                abi: megaethSessionEscrowAbi,
                account: serverAccount,
                address: escrowContract,
                args: [channelId, cumulativeAmount, signature],
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
                chainId,
                intent: "session" as const,
                method: "evm" as const,
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
      mppx.evm.session({})(request),
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
