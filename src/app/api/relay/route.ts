import { NextResponse } from "next/server";
import { isHex } from "viem";
import { sendRawTransactionRealtime } from "@/lib/megaeth-realtime";
import { publicClient, getServerWallet } from "@/lib/server-wallet";

type Body = { rawTx?: string };

export async function POST(request: Request) {
  const wallet = getServerWallet();
  if (!wallet) {
    return NextResponse.json(
      { ok: false, error: "SERVER_PRIVATE_KEY not set" },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (!body.rawTx || !isHex(body.rawTx)) {
    return NextResponse.json({ ok: false, error: "rawTx hex required" }, { status: 400 });
  }

  try {
    const receipt = await sendRawTransactionRealtime(publicClient, {
      serializedTransaction: body.rawTx,
    });
    return NextResponse.json({ ok: true, hash: receipt.transactionHash });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "broadcast failed" },
      { status: 500 },
    );
  }
}
