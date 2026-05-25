import { NextResponse, type NextRequest } from "next/server";
import { Errors, Method, Receipt } from "mppx";
import { Mppx } from "mppx/server";
import { parseSignature, type Address, type Hex } from "viem";
import { readContract } from "viem/actions";

import { megaethTestnet } from "@/lib/chain";
import { writeContractRealtime } from "@/lib/megaeth-realtime";
import { publicClient, getServerWallet, serverAccount } from "@/lib/server-wallet";
import { getRandomProtectedImage } from "@/lib/protected-image";
import {
  MPP_GASLESS_CHARGE_AMOUNT_HUMAN,
  MPP_GASLESS_EXPLICIT_TOKEN_VERSION,
  MPP_GASLESS_TOKEN_ADDRESS,
  MPP_GASLESS_TOKEN_DECIMALS,
  MPP_GASLESS_TOKEN_NAME,
  MPP_GASLESS_TOKEN_VERSION,
  getMppGaslessPayToAddress,
  getMppGaslessReadiness,
  getMppGaslessSecretKey,
  getMppGaslessSpenderAddress,
} from "@/lib/mpp-gasless-config";
import {
  PERMIT20_METHOD_NAME,
  createPermit20Source,
  permit20ChargeMethod,
  permit20Erc20Abi,
  recoverPermit20Signer,
  selectPermit20Domain,
} from "@/lib/mpp-permit20";
import {
  attachPaymentServerTiming,
  collectPaymentServerTiming,
  recordPaymentOnChainSegment,
} from "@/lib/payment-timing-server";

type MppxHandler = ReturnType<typeof Mppx.create<readonly [ReturnType<typeof Method.toServer>]>>;

let cached: MppxHandler | null = null;
let cachedRealm: string | null = null;
let cachedDomain:
  | {
      tokenName: string;
      tokenVersion: string;
    }
  | null = null;

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
  const v = "v" in parsed && parsed.v !== undefined
    ? Number(parsed.v)
    : parsed.yParity + 27;
  if (v !== 27 && v !== 28) {
    throw new Errors.VerificationFailedError({
      reason: `unsupported permit signature v ${v}`,
    });
  }
  return v;
}

async function readTokenDomain() {
  try {
    const domain = await readContract(publicClient, {
      abi: permit20Erc20Abi,
      address: MPP_GASLESS_TOKEN_ADDRESS,
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
        address: MPP_GASLESS_TOKEN_ADDRESS,
        functionName: "name",
      });
      return { tokenDomainName, tokenDomainVersion: undefined };
    } catch {
      return { tokenDomainName: undefined, tokenDomainVersion: undefined };
    }
  }
}

async function getTokenDomainDefaults() {
  if (cachedDomain) return cachedDomain;

  const { tokenDomainName, tokenDomainVersion } = await readTokenDomain();
  cachedDomain = selectPermit20Domain({
    explicitVersion: MPP_GASLESS_EXPLICIT_TOKEN_VERSION,
    fallbackName: MPP_GASLESS_TOKEN_NAME,
    fallbackVersion: MPP_GASLESS_TOKEN_VERSION,
    tokenDomainName,
    tokenDomainVersion,
  });

  return cachedDomain;
}

async function getMppx(realm: string): Promise<MppxHandler> {
  if (cached && cachedRealm === realm) return cached;

  const secretKey = getMppGaslessSecretKey();
  const recipient = getMppGaslessPayToAddress();
  const spender = getMppGaslessSpenderAddress();
  const serverWalletClient = getServerWallet();
  const tokenDomain = await getTokenDomainDefaults();

  if (!secretKey || !recipient || !spender || !serverWalletClient || !serverAccount) {
    throw new Error("MPP gasless charge route is not configured");
  }

  cached = Mppx.create({
    methods: [
      Method.toServer(permit20ChargeMethod, {
        defaults: {
          amount: MPP_GASLESS_CHARGE_AMOUNT_HUMAN,
          chainId: megaethTestnet.id,
          currency: MPP_GASLESS_TOKEN_ADDRESS,
          decimals: MPP_GASLESS_TOKEN_DECIMALS,
          recipient,
          spender,
          tokenName: tokenDomain.tokenName,
          tokenVersion: tokenDomain.tokenVersion,
        },
        async verify({ credential }) {
          const challenge = credential.challenge;
          const request = challenge.request;
          const methodDetails = request.methodDetails as
            | {
                chainId?: number;
                spender?: Address;
                tokenName?: string;
                tokenVersion?: string;
              }
            | undefined;
          const chainId = methodDetails?.chainId ?? megaethTestnet.id;
          const currency = request.currency as Address;
          const requestRecipient = request.recipient as Address;
          const requestSpender = (methodDetails?.spender ?? spender) as Address;
          const tokenName = methodDetails?.tokenName ?? MPP_GASLESS_TOKEN_NAME;
          const tokenVersion =
            methodDetails?.tokenVersion ?? MPP_GASLESS_TOKEN_VERSION;
          const amount = BigInt(request.amount);
          const payload = credential.payload;

          if (payload.type !== "permit20") {
            throw new Errors.VerificationFailedError({
              reason: "gasless charge requires permit20 payload",
            });
          }

          const owner = payload.owner as Address;
          const payloadSpender = payload.spender as Address;
          const payloadValue = BigInt(payload.value);
          const payloadNonce = BigInt(payload.nonce);
          const payloadDeadline = BigInt(payload.deadline);
          const signature = payload.signature as Hex;

          assertSameAddress(currency, MPP_GASLESS_TOKEN_ADDRESS, "currency");
          assertSameAddress(requestRecipient, recipient, "recipient");
          assertSameAddress(requestSpender, spender, "spender");
          assertSameAddress(payloadSpender, spender, "payload spender");

          if (payloadValue !== amount) {
            throw new Errors.VerificationFailedError({
              reason: `permit value ${payloadValue} does not match charge amount ${amount}`,
            });
          }

          if (payloadDeadline < BigInt(Math.floor(Date.now() / 1000))) {
            throw new Errors.VerificationFailedError({
              reason: "permit deadline has expired",
            });
          }

          const expectedSource = createPermit20Source(chainId, owner);
          if (
            credential.source &&
            credential.source.toLowerCase() !== expectedSource.toLowerCase()
          ) {
            throw new Errors.VerificationFailedError({
              reason: `credential source ${credential.source} does not match owner ${owner}`,
            });
          }

          const recovered = await recoverPermit20Signer({
            chainId,
            deadline: payloadDeadline,
            nonce: payloadNonce,
            owner,
            signature,
            spender,
            token: currency,
            tokenName,
            tokenVersion,
            value: payloadValue,
          });
          assertSameAddress(recovered as Address, owner, "recovered signer");

          const [currentNonce, balance] = await Promise.all([
            readContract(publicClient, {
              abi: permit20Erc20Abi,
              address: currency,
              args: [owner],
              functionName: "nonces",
            }),
            readContract(publicClient, {
              abi: permit20Erc20Abi,
              address: currency,
              args: [owner],
              functionName: "balanceOf",
            }),
          ]);

          if (currentNonce !== payloadNonce) {
            throw new Errors.VerificationFailedError({
              reason: `permit nonce ${payloadNonce} does not match current token nonce ${currentNonce}`,
            });
          }

          if (balance < amount) {
            throw new Errors.VerificationFailedError({
              reason: `owner token balance ${balance} is below charge amount ${amount}`,
            });
          }

          const { r, s } = parseSignature(signature);
          const v = getRecoveryId(signature);

          const permitStartedAt = performance.now();
          const permitReceipt = await writeContractRealtime(serverWalletClient, {
            abi: permit20Erc20Abi,
            account: serverAccount,
            address: currency,
            args: [owner, spender, amount, payloadDeadline, v, r, s],
            functionName: "permit",
          });
          const permitHash = permitReceipt.transactionHash;
          recordPaymentOnChainSegment({
            durationMs: performance.now() - permitStartedAt,
            hash: permitHash,
            label: "permit",
          });

          const transferStartedAt = performance.now();
          const transferReceipt = await writeContractRealtime(serverWalletClient, {
            abi: permit20Erc20Abi,
            account: serverAccount,
            address: currency,
            args: [owner, recipient, amount],
            functionName: "transferFrom",
          });
          const transferHash = transferReceipt.transactionHash;
          recordPaymentOnChainSegment({
            durationMs: performance.now() - transferStartedAt,
            hash: transferHash,
            label: "transferFrom",
          });

          return Receipt.from({
            method: PERMIT20_METHOD_NAME,
            reference: transferHash,
            status: "success",
            timestamp: new Date().toISOString(),
          });
        },
      }),
    ],
    realm,
    secretKey,
  }) as unknown as MppxHandler;
  cachedRealm = realm;
  return cached;
}

export async function GET(request: NextRequest): Promise<Response> {
  const readiness = getMppGaslessReadiness();
  if (!readiness.ready) {
    return NextResponse.json(
      {
        error: "MPP gasless charge route is not configured yet.",
        missingEnv: readiness.missingEnv,
      },
      { status: 503 },
    );
  }

  const realm = new URL(request.url).host;
  const mppx = await getMppx(realm);
  const { timing, value: result } = await collectPaymentServerTiming(() =>
    mppx["permit20/charge"]({})(request),
  );

  if (result.status === 402) {
    return result.challenge;
  }

  return attachPaymentServerTiming(
    result.withReceipt(
      NextResponse.json({
        ok: true,
        route: "mpp/gasless-charge",
        secret:
          "You paid 1 USDm via gasless MPP. Here is the protected content.",
        when: new Date().toISOString(),
        quote:
          "Authorization stays with the payer; gas can be someone else's job.",
        image: getRandomProtectedImage(),
      }),
    ),
    timing,
  );
}
