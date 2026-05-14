import { x402Client, x402HTTPClient, type PaymentRequired } from "@x402/fetch";

export type X402PreviewResponse = {
  status: number;
  paymentRequired: PaymentRequired | null;
  body: unknown;
};

function parseBodyText(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function readX402PreviewResponse(response: Response): Promise<X402PreviewResponse> {
  const body = parseBodyText(await response.text());
  const httpClient = new x402HTTPClient(new x402Client());
  let paymentRequired: PaymentRequired | null = null;

  try {
    paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      body ?? undefined,
    );
  } catch {
    paymentRequired = null;
  }

  return {
    status: response.status,
    paymentRequired,
    body,
  };
}
