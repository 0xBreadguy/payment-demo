import {
  parseAbi,
  parseUnits,
  recoverTypedDataAddress,
  type Account,
  type Address,
  type Client,
  type Hex,
} from "viem";
import { signTypedData } from "viem/actions";
import { Method, z } from "mppx";

export const PERMIT20_METHOD_NAME = "permit20";

export const permit20Erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function name() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
]);

const permit20Types = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type Permit20SigParams = {
  chainId: number;
  deadline: bigint;
  nonce: bigint;
  owner: Address;
  spender: Address;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  value: bigint;
};

export type Permit20DomainSelection = {
  explicitName?: string;
  explicitVersion?: string;
  fallbackName: string;
  fallbackVersion: string;
  tokenDomainName?: string;
  tokenDomainVersion?: string;
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function selectPermit20Domain(p: Permit20DomainSelection) {
  return {
    tokenName:
      nonEmpty(p.explicitName) ??
      nonEmpty(p.tokenDomainName) ??
      p.fallbackName,
    tokenVersion:
      nonEmpty(p.explicitVersion) ??
      nonEmpty(p.tokenDomainVersion) ??
      p.fallbackVersion,
  };
}

export function buildPermit20TypedData(p: Permit20SigParams) {
  return {
    domain: {
      chainId: p.chainId,
      name: p.tokenName,
      verifyingContract: p.token,
      version: p.tokenVersion,
    },
    message: {
      deadline: p.deadline,
      nonce: p.nonce,
      owner: p.owner,
      spender: p.spender,
      value: p.value,
    },
    primaryType: "Permit" as const,
    types: permit20Types,
  };
}

export async function signPermit20(parameters: {
  account: Account | Address;
  client: Client;
} & Permit20SigParams) {
  const { account, client, ...rest } = parameters;
  return signTypedData(client, {
    account,
    ...buildPermit20TypedData(rest),
  });
}

export async function recoverPermit20Signer(parameters: {
  signature: Hex;
} & Permit20SigParams) {
  const { signature, ...rest } = parameters;
  return recoverTypedDataAddress({
    ...buildPermit20TypedData(rest),
    signature,
  });
}

export function createPermit20Source(chainId: number, address: Address) {
  return `did:pkh:eip155:${chainId}:${address}`;
}

export const permit20ChargeMethod = Method.from({
  intent: "charge",
  name: PERMIT20_METHOD_NAME,
  schema: {
    credential: {
      payload: z.object({
        deadline: z.amount(),
        nonce: z.amount(),
        owner: z.address(),
        signature: z.signature(),
        spender: z.address(),
        type: z.literal("permit20"),
        value: z.amount(),
      }),
    },
    request: z.pipe(
      z.object({
        amount: z.amount(),
        chainId: z.number(),
        currency: z.address(),
        decimals: z.number(),
        recipient: z.address(),
        spender: z.address(),
        tokenName: z.string(),
        tokenVersion: z.string(),
      }),
      z.transform(
        ({
          amount,
          chainId,
          decimals,
          recipient,
          spender,
          tokenName,
          tokenVersion,
          ...rest
        }) => ({
          ...rest,
          amount: parseUnits(amount, decimals).toString(),
          methodDetails: {
            chainId,
            spender,
            tokenName,
            tokenVersion,
          },
          recipient,
        }),
      ),
    ),
  },
});
