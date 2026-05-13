import { NextResponse, type NextRequest } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import { getFacilitatorAccountAddress } from "@/lib/x402-facilitator";
import {
  X402_NETWORK,
  X402_TOKEN_ADDRESS,
  X402_TOKEN_NAME,
  X402_TOKEN_VERSION,
  X402_TOKEN_PRICE,
  getFacilitatorUrl,
  getPayToAddress,
} from "@/lib/x402-config";

async function handler(_request: NextRequest) {
  return NextResponse.json({
    secret: "🎉 You paid 1 USDm. Here is the protected content.",
    when: new Date().toISOString(),
    quote:
      "Money is just a tool. Useful when it flows; useless when it sits.",
  });
}

const facilitatorAddress = getFacilitatorAccountAddress();
const fallbackPayTo = (facilitatorAddress ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
const payTo = getPayToAddress(fallbackPayTo);

const facilitatorClient = new HTTPFacilitatorClient({ url: getFacilitatorUrl() });

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  X402_NETWORK,
  new ExactEvmScheme(),
);

export const GET = withX402(
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
            name: X402_TOKEN_NAME,
            version: X402_TOKEN_VERSION,
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
