import { type Address, type Hex } from "viem";
import { PERMIT2_ADDRESS } from "./megaeth-session.ts";
import { recoverPermit20Signer } from "./mpp-permit20.ts";

export type MppSessionPermit20ApprovalPayload = {
  deadline: string;
  nonce: string;
  owner: Address;
  signature: Hex;
  spender: Address;
  type: "permit20";
  value: string;
};

export function buildMppSessionPermit20ApprovalPayload(parameters: {
  deadline: bigint;
  nonce: bigint;
  owner: Address;
  signature: Hex;
  value: bigint;
}): MppSessionPermit20ApprovalPayload {
  return {
    deadline: parameters.deadline.toString(),
    nonce: parameters.nonce.toString(),
    owner: parameters.owner,
    signature: parameters.signature,
    spender: PERMIT2_ADDRESS,
    type: "permit20",
    value: parameters.value.toString(),
  };
}

function sameAddress(a: Address, b: Address) {
  return a.toLowerCase() === b.toLowerCase();
}

export function getMppSessionPermit20ApprovalIssue(
  payload: MppSessionPermit20ApprovalPayload | undefined,
  parameters: {
    expectedOwner: Address;
    nowSeconds: bigint;
    requiredValue: bigint;
  },
): string | null {
  if (!payload) return "missing permit20 approval payload";

  if (payload.type !== "permit20") {
    return "permit20 approval payload has an unsupported type";
  }

  if (!sameAddress(payload.owner, parameters.expectedOwner)) {
    return `permit20 approval owner ${payload.owner} does not match expected ${parameters.expectedOwner}`;
  }

  if (!sameAddress(payload.spender, PERMIT2_ADDRESS)) {
    return `permit20 approval spender ${payload.spender} does not match Permit2 ${PERMIT2_ADDRESS}`;
  }

  let value: bigint;
  try {
    value = BigInt(payload.value);
  } catch {
    return "permit20 approval value is invalid";
  }
  if (value !== parameters.requiredValue) {
    return `permit20 approval value ${value} does not match required ${parameters.requiredValue}`;
  }

  let deadline: bigint;
  try {
    deadline = BigInt(payload.deadline);
  } catch {
    return "permit20 approval deadline is invalid";
  }
  if (deadline < parameters.nowSeconds) {
    return "permit20 approval deadline has expired";
  }

  return null;
}

export async function recoverMppSessionPermit20ApprovalSigner(parameters: {
  chainId: number;
  payload: MppSessionPermit20ApprovalPayload;
  token: Address;
  tokenName: string;
  tokenVersion: string;
}) {
  const { chainId, payload, token, tokenName, tokenVersion } = parameters;

  return recoverPermit20Signer({
    chainId,
    deadline: BigInt(payload.deadline),
    nonce: BigInt(payload.nonce),
    owner: payload.owner,
    signature: payload.signature,
    spender: payload.spender,
    token,
    tokenName,
    tokenVersion,
    value: BigInt(payload.value),
  });
}
