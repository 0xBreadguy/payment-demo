import { NextResponse, type NextRequest } from "next/server";
import { Errors, Method, z } from "mppx";
import { Mppx } from "mppx/server";
import { Methods } from "mppx/tempo";
import { type Address, type Hex } from "viem";
import { waitForTransactionReceipt, writeContract } from "viem/actions";

import { megaethTestnet } from "@/lib/chain";
import { publicClient, getServerWallet, serverAccount } from "@/lib/server-wallet";
import { getRandomProtectedImage } from "@/lib/protected-image";
import {
  computeMegaethSessionChannelId,
  getMegaethSessionAuthorizedSigner,
  getOnChainMegaethSessionChannel,
  megaethSessionEscrowAbi,
  hydrateMegaethSessionChannelState,
  type MegaethSessionChannelState,
  recoverPermit2OpenSigner,
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

// Relax credential payload to accept the Permit2 variants of open/topUp.
const sessionMethodWithPermit2 = Method.from({
  name: Methods.session.name,
  intent: Methods.session.intent,
  schema: {
    credential: { payload: z.any() },
    request: Methods.session.schema.request,
  },
});

const sessions = new Map<Hex, MegaethSessionChannelState>();

type MppxHandler = ReturnType<typeof Mppx.create<readonly [ReturnType<typeof Method.toServer>]>>;

let cached: MppxHandler | null = null;
let cachedRealm: string | null = null;

function getMppx(realm: string): MppxHandler {
  if (cached && cachedRealm === realm) return cached;

  const secretKey = getMppSecretKey();
  const recipient = getMppSessionPayToAddress();
  const serverWalletClient = getServerWallet();

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
              console.log("[mpp-session] openWithPermit2 args", {
                escrowContract,
                payer,
                payee: sessionRecipient,
                token,
                deposit: deposit.toString(),
                salt,
                authorizedSigner,
                permit2Nonce: permit2Nonce.toString(),
                permit2Deadline: permit2Deadline.toString(),
                permit2Signature,
              });

              // Pre-flight check: payer's allowance + balance for Permit2.
              const allowance = (await publicClient.readContract({
                abi: [
                  {
                    type: "function",
                    name: "allowance",
                    stateMutability: "view",
                    inputs: [
                      { name: "owner", type: "address" },
                      { name: "spender", type: "address" },
                    ],
                    outputs: [{ type: "uint256" }],
                  },
                ] as const,
                address: token,
                args: [payer, "0x000000000022D473030F116dDEE9F6B43aC78BA3"],
                functionName: "allowance",
              })) as bigint;
              const payerBalance = (await publicClient.readContract({
                abi: [
                  {
                    type: "function",
                    name: "balanceOf",
                    stateMutability: "view",
                    inputs: [{ name: "account", type: "address" }],
                    outputs: [{ type: "uint256" }],
                  },
                ] as const,
                address: token,
                args: [payer],
                functionName: "balanceOf",
              })) as bigint;
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
              console.log("[mpp-session] preflight", {
                permit2Allowance: allowance.toString(),
                payerBalance: payerBalance.toString(),
                needed: deposit.toString(),
                serverRecoveredSigner,
                expectedPayer: payer,
                match:
                  serverRecoveredSigner.toLowerCase() === payer.toLowerCase(),
              });
              if (
                serverRecoveredSigner.toLowerCase() !== payer.toLowerCase()
              ) {
                throw new Errors.VerificationFailedError({
                  reason: `Permit2 signature recovers to ${serverRecoveredSigner} on server, expected payer ${payer}. Wallet/digest mismatch.`,
                });
              }

              const permit2Code = await publicClient.getCode({
                address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
              });
              const escrowCode = await publicClient.getCode({
                address: escrowContract,
              });
              const tokenCode = await publicClient.getCode({ address: token });
              console.log("[mpp-session] code presence", {
                permit2: permit2Code ? permit2Code.length : 0,
                escrow: escrowCode ? escrowCode.length : 0,
                token: tokenCode ? tokenCode.length : 0,
              });

              // Simulate via eth_call to surface a revert reason.
              try {
                await publicClient.simulateContract({
                  abi: megaethSessionEscrowAbi,
                  account: serverAccount,
                  address: escrowContract,
                  args: openArgs,
                  functionName: "openWithPermit2",
                });
                console.log("[mpp-session] simulate openWithPermit2 OK");
              } catch (simErr) {
                console.error("[mpp-session] simulate openWithPermit2 FAILED", {
                  name: (simErr as Error)?.name,
                  message: (simErr as Error)?.message,
                  shortMessage: (simErr as { shortMessage?: string })
                    ?.shortMessage,
                  metaMessages: (simErr as { metaMessages?: string[] })
                    ?.metaMessages,
                  cause: (simErr as { cause?: unknown })?.cause,
                });
              }
              if (allowance < deposit) {
                throw new Errors.VerificationFailedError({
                  reason: `Permit2 allowance ${allowance} < deposit ${deposit} on USDm from payer ${payer}`,
                });
              }
              if (payerBalance < deposit) {
                throw new Errors.VerificationFailedError({
                  reason: `Payer USDm balance ${payerBalance} < deposit ${deposit}`,
                });
              }

              const openHash = await writeContract(serverWalletClient, {
                abi: megaethSessionEscrowAbi,
                account: serverAccount,
                address: escrowContract,
                args: openArgs,
                functionName: "openWithPermit2",
              });

              await waitForTransactionReceipt(serverWalletClient, {
                hash: openHash,
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

              sessions.set(channelId, state);

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
                txHash: openHash,
                units: state.units,
              };
            }

            case "voucher": {
              const channelId = p.channelId as Hex;
              const existing = sessions.get(channelId);

              if (!existing) {
                throw new Errors.VerificationFailedError({
                  reason: "session channel is not known to the server",
                });
              }

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

              sessions.set(channelId, nextState);

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
              const existing = sessions.get(channelId);

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

              const topUpHash = await writeContract(serverWalletClient, {
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

              await waitForTransactionReceipt(serverWalletClient, {
                hash: topUpHash,
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

              const nextState = {
                ...existing,
                closeRequestedAt: onChain.closeRequestedAt,
                deposit: onChain.deposit,
                finalized: onChain.finalized,
                settledOnChain: onChain.settled,
              } satisfies MegaethSessionChannelState;

              sessions.set(channelId, nextState);

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
                txHash: topUpHash,
                units: nextState.units,
              };
            }

            case "close": {
              const channelId = p.channelId as Hex;
              const existing = sessions.get(channelId);

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

              const closeHash = await writeContract(serverWalletClient, {
                abi: megaethSessionEscrowAbi,
                account: serverAccount,
                address: escrowContract,
                args: [channelId, cumulativeAmount, p.signature as Hex],
                functionName: "close",
              });

              await waitForTransactionReceipt(serverWalletClient, {
                hash: closeHash,
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

              sessions.delete(channelId);

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
        error: "MPP session route is not configured yet.",
        missingEnv: readiness.missingEnv,
      },
      { status: 503 },
    );
  }

  const realm = new URL(request.url).host;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mppx = getMppx(realm) as any;
  const result = await mppx.tempo.session({})(request);

  if (result.status === 402) {
    return result.challenge;
  }

  return result.withReceipt(
    NextResponse.json({
      ok: true,
      route: "mpp/session",
      message: "MegaETH session payment accepted.",
      when: new Date().toISOString(),
      image: getRandomProtectedImage(),
    }),
  );
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
