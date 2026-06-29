import { NextResponse, type NextRequest } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import { parseAbi, type Address, type Hex } from "viem";
import { getFacilitatorAccountAddress } from "@/lib/x402-facilitator";
import {
  X402_NETWORK,
  X402_TOKEN_ADDRESS,
  X402_TOKEN_VERSION,
  X402_TOKEN_PRICE,
  getPayToAddress,
  selectX402TokenDomain,
} from "@/lib/x402-config";
import { getResourceFacilitatorClient } from "@/lib/x402-resource-facilitator-client";
import { getRandomProtectedImage } from "@/lib/protected-image";
import { publicClient } from "@/lib/server-wallet";
import {
  attachPaymentServerTiming,
  collectPaymentServerTiming,
} from "@/lib/payment-timing-server";

const x402TokenDomainAbi = parseAbi([
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function name() view returns (string)",
]);

async function handler() {
  return NextResponse.json({
    secret: "🎉 You paid 1 USDm. Here is the protected content.",
    when: new Date().toISOString(),
    quote:
      "Money is just a tool. Useful when it flows; useless when it sits.",
    image: getRandomProtectedImage(),
  });
}

const facilitatorAddress = getFacilitatorAccountAddress();
const fallbackPayTo = (facilitatorAddress ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
const payTo = getPayToAddress(fallbackPayTo);

const resourceServer = new x402ResourceServer(getResourceFacilitatorClient()).register(
  X402_NETWORK,
  new ExactEvmScheme(),
);

let cachedTokenDomain:
  | Promise<{
      tokenName: string;
      tokenVersion: string;
    }>
  | null = null;

let cachedGetHandler: ((request: NextRequest) => Promise<Response>) | null = null;

async function readTokenDomain() {
  try {
    const domain = await publicClient.readContract({
      abi: x402TokenDomainAbi,
      address: X402_TOKEN_ADDRESS,
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
      const tokenDomainName = await publicClient.readContract({
        abi: x402TokenDomainAbi,
        address: X402_TOKEN_ADDRESS,
        functionName: "name",
      });
      return { tokenDomainName, tokenDomainVersion: undefined };
    } catch {
      return { tokenDomainName: undefined, tokenDomainVersion: undefined };
    }
  }
}

function getTokenDomain() {
  cachedTokenDomain ??= readTokenDomain().then((tokenDomain) =>
    selectX402TokenDomain({
      fallbackName: "USDm",
      fallbackVersion: X402_TOKEN_VERSION,
      ...tokenDomain,
    }),
  );
  return cachedTokenDomain;
}

async function getX402GetHandler() {
  if (cachedGetHandler) return cachedGetHandler;

  const tokenDomain = await getTokenDomain();
  cachedGetHandler = withX402(
    handler,
    {
      accepts: [
        {
          scheme: "exact",
          network: X402_NETWORK,
          payTo,
          price: {
            amount: X402_TOKEN_PRICE,
            asset: X402_TOKEN_ADDRESS,
            extra: {
              name: tokenDomain.tokenName,
              version: tokenDomain.tokenVersion,
              assetTransferMethod: "permit2",
            },
          },
        },
      ],
      description: "Pay 1 USDm to view the protected content",
      mimeType: "application/json",
      extensions: {
        ...declareEip2612GasSponsoringExtension(),
      },
    },
    resourceServer,
  );
  return cachedGetHandler;
}

export async function GET(request: NextRequest) {
  const getHandler = await getX402GetHandler();
  const { timing, value: response } = await collectPaymentServerTiming(() =>
    getHandler(request),
  );
  return attachPaymentServerTiming(response, timing);
}
