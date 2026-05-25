import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { writeContractRealtime } from "@/lib/megaeth-realtime";
import { publicClient, getServerWallet } from "@/lib/server-wallet";
import { FAUCET_AMOUNT, USDM_ADDRESS, usdmAbi } from "@/lib/usdm";

type Body = { address?: string };

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

  const to = body.address;
  if (!to || !isAddress(to)) {
    return NextResponse.json(
      { ok: false, error: "valid address required" },
      { status: 400 },
    );
  }

  try {
    const { request: simulated } = await publicClient.simulateContract({
      account: wallet.account,
      address: USDM_ADDRESS,
      abi: usdmAbi,
      functionName: "mint",
      args: [to, FAUCET_AMOUNT],
    });
    const receipt = await writeContractRealtime(wallet, simulated);
    return NextResponse.json({
      ok: true,
      hash: receipt.transactionHash,
      amount: FAUCET_AMOUNT.toString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "mint failed" },
      { status: 500 },
    );
  }
}
