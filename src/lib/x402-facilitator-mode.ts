export type X402FacilitatorMode = "local" | "http";

export function getX402FacilitatorMode(
  explicitFacilitatorUrl = process.env.X402_FACILITATOR_URL,
): X402FacilitatorMode {
  return explicitFacilitatorUrl ? "http" : "local";
}
