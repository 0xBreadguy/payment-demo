import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { Mppx, tempo } from "mppx/server";
import { megaethTestnet } from "@/lib/chain";
import { getRandomProtectedImage } from "@/lib/protected-image";
import {
  MPP_CHARGE_AMOUNT_HUMAN,
  MPP_TOKEN_ADDRESS,
  MPP_TOKEN_DECIMALS,
  getMppPayToAddress,
  getMppReadiness,
  getMppSecretKey,
} from "@/lib/mpp-config";

type MppxHandler = ReturnType<typeof Mppx.create<readonly [ReturnType<typeof tempo.charge>]>>;

let cached: MppxHandler | null = null;
let cachedRealm: string | null = null;

function getMppx(realm: string): MppxHandler {
  if (cached && cachedRealm === realm) return cached;
  const secretKey = getMppSecretKey();
  const recipient = getMppPayToAddress();
  if (!secretKey || !recipient) {
    throw new Error("MPP not configured");
  }
  const rpcUrl =
    process.env.MEGAETH_RPC_URL ?? "https://carrot.megaeth.com/rpc";

  cached = Mppx.create({
    methods: [
      tempo.charge({
        amount: MPP_CHARGE_AMOUNT_HUMAN,
        chainId: megaethTestnet.id,
        currency: MPP_TOKEN_ADDRESS,
        decimals: MPP_TOKEN_DECIMALS,
        description: "Pay 1 USDm via MPP to view the protected content",
        getClient: () =>
          createPublicClient({
            chain: megaethTestnet,
            transport: http(rpcUrl),
          }),
        recipient,
      }),
    ],
    realm,
    secretKey,
  });
  cachedRealm = realm;
  return cached;
}

export async function GET(request: NextRequest): Promise<Response> {
  const readiness = getMppReadiness();
  if (!readiness.ready) {
    return NextResponse.json(
      {
        error: "MPP charge route is not configured yet.",
        missingEnv: readiness.missingEnv,
      },
      { status: 503 },
    );
  }

  const realm = new URL(request.url).host;
  const mppx = getMppx(realm);
  const result = await mppx.tempo.charge({})(request);

  if (result.status === 402) {
    return result.challenge;
  }

  return result.withReceipt(
    NextResponse.json({
      ok: true,
      route: "mpp/charge",
      secret: "🎉 You paid 1 USDm via MPP. Here is the protected content.",
      when: new Date().toISOString(),
      quote: "Payment is a protocol. Settle, verify, deliver.",
      image: getRandomProtectedImage(),
    }),
  );
}
