import "server-only";

import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { getFacilitator } from "./x402-facilitator";
import { getFacilitatorAuthHeaders } from "./x402-facilitator-auth";
import { getX402FacilitatorMode } from "./x402-facilitator-mode";
import { getFacilitatorUrl } from "./x402-config";

class LocalX402FacilitatorClient implements FacilitatorClient {
  private get facilitator() {
    const facilitator = getFacilitator();
    if (!facilitator) {
      throw new Error("Facilitator unavailable: SERVER_PRIVATE_KEY not set");
    }
    return facilitator;
  }

  async getSupported(): Promise<SupportedResponse> {
    return this.facilitator.getSupported() as SupportedResponse;
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.facilitator.verify(paymentPayload, paymentRequirements);
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.facilitator.settle(paymentPayload, paymentRequirements);
  }
}

let localFacilitatorClient: LocalX402FacilitatorClient | null = null;

function getLocalFacilitatorClient() {
  localFacilitatorClient ??= new LocalX402FacilitatorClient();
  return localFacilitatorClient;
}

export function getResourceFacilitatorClient(): FacilitatorClient {
  if (getX402FacilitatorMode() === "local") {
    return getLocalFacilitatorClient();
  }

  const facilitatorUrl = getFacilitatorUrl();
  return new HTTPFacilitatorClient({
    url: facilitatorUrl,
    createAuthHeaders: getFacilitatorAuthHeaders(facilitatorUrl),
  });
}
