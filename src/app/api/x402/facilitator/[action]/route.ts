import { NextResponse } from "next/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { getFacilitator } from "@/lib/x402-facilitator";

type Action = "verify" | "settle" | "supported";

async function ensureFacilitator() {
  const f = getFacilitator();
  if (!f) {
    return {
      error: NextResponse.json(
        { error: "Facilitator unavailable: SERVER_PRIVATE_KEY not set" },
        { status: 503 },
      ),
      facilitator: null as never,
    };
  }
  return { error: null, facilitator: f };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (action !== "supported") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { facilitator, error } = await ensureFacilitator();
  if (error) return error;
  try {
    return NextResponse.json(facilitator.getSupported());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "supported failed" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = (await params) as { action: Action };
  if (action !== "verify" && action !== "settle") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { facilitator, error } = await ensureFacilitator();
  if (error) return error;

  let body: { paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.paymentPayload || !body.paymentRequirements) {
    return NextResponse.json(
      { error: "Missing paymentPayload or paymentRequirements" },
      { status: 400 },
    );
  }

  try {
    if (action === "verify") {
      const res = await facilitator.verify(body.paymentPayload, body.paymentRequirements);
      return NextResponse.json(res);
    }
    const res = await facilitator.settle(body.paymentPayload, body.paymentRequirements);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : `${action} failed` },
      { status: 500 },
    );
  }
}
