import { NextResponse } from "next/server";
import { publicClient, serverAccount } from "@/lib/server-wallet";

export async function GET() {
  try {
    const [blockNumber, chainId] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getChainId(),
    ]);
    return NextResponse.json({
      ok: true,
      chainId,
      blockNumber: blockNumber.toString(),
      serverAddress: serverAccount?.address ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}
