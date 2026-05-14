import {
  encodeAbiParameters,
  keccak256,
  maxUint256,
  parseAbi,
  recoverTypedDataAddress,
  zeroAddress,
  type Account,
  type Address,
  type Client,
  type Hex,
} from "viem";
import { readContract, signTypedData } from "viem/actions";

export const PERMIT2_ADDRESS: Address =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export { maxUint256 };

export const megaethErc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const megaethSessionEscrowAbi = parseAbi([
  "function getChannel(bytes32 channelId) view returns ((bool finalized, uint64 closeRequestedAt, address payer, address payee, address token, address authorizedSigner, uint128 deposit, uint128 settled))",
  "function openWithPermit2(address payer, address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner, uint256 nonce, uint256 deadline, bytes permit2Signature) returns (bytes32 channelId)",
  "function close(bytes32 channelId, uint128 cumulativeAmount, bytes signature)",
  "function topUpWithPermit2(bytes32 channelId, uint256 additionalDeposit, uint256 nonce, uint256 deadline, bytes permit2Signature)",
]);

export type MegaethSessionPaymentPlan =
  | {
      action: "open";
      depositAmount: bigint;
      nextCumulativeAmount: bigint;
    }
  | {
      action: "voucher";
      nextCumulativeAmount: bigint;
    }
  | {
      action: "topUp";
      additionalDeposit: bigint;
      nextCumulativeAmount: bigint;
    };

const voucherTypes = {
  Voucher: [
    { name: "channelId", type: "bytes32" },
    { name: "cumulativeAmount", type: "uint128" },
  ],
} as const;

type SessionVoucher = {
  channelId: Hex;
  cumulativeAmount: bigint;
  signature: Hex;
};

export type OnChainMegaethSessionChannel = {
  authorizedSigner: Address;
  closeRequestedAt: bigint;
  deposit: bigint;
  finalized: boolean;
  payee: Address;
  payer: Address;
  settled: bigint;
  token: Address;
};

export type MegaethSessionChannelState = {
  authorizedSigner: Address;
  chainId: number;
  channelId: Hex;
  closeRequestedAt: bigint;
  createdAt: string;
  deposit: bigint;
  escrowContract: Address;
  finalized: boolean;
  highestVoucherAmount: bigint;
  payee: Address;
  payer: Address;
  settledOnChain: bigint;
  spent: bigint;
  token: Address;
  units: number;
};

export function getMegaethSessionPaymentPlan(parameters: {
  configuredDeposit: bigint;
  requestAmount: bigint;
  state?: {
    cumulativeAmount: bigint;
    depositAmount: bigint;
    opened: boolean;
  };
}): MegaethSessionPaymentPlan {
  const { configuredDeposit, requestAmount, state } = parameters;

  if (!state?.opened) {
    return {
      action: "open",
      depositAmount: configuredDeposit,
      nextCumulativeAmount: requestAmount,
    };
  }

  const nextCumulativeAmount = state.cumulativeAmount + requestAmount;

  if (nextCumulativeAmount <= state.depositAmount) {
    return {
      action: "voucher",
      nextCumulativeAmount,
    };
  }

  return {
    action: "topUp",
    additionalDeposit: configuredDeposit,
    nextCumulativeAmount,
  };
}

export function computeMegaethSessionChannelId(parameters: {
  authorizedSigner: Address;
  chainId: number;
  escrowContract: Address;
  payee: Address;
  payer: Address;
  salt: Hex;
  token: Address;
}) {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "payer", type: "address" },
        { name: "payee", type: "address" },
        { name: "token", type: "address" },
        { name: "salt", type: "bytes32" },
        { name: "authorizedSigner", type: "address" },
        { name: "escrowContract", type: "address" },
        { name: "chainId", type: "uint256" },
      ],
      [
        parameters.payer,
        parameters.payee,
        parameters.token,
        parameters.salt,
        parameters.authorizedSigner,
        parameters.escrowContract,
        BigInt(parameters.chainId),
      ],
    ),
  );
}

export async function getOnChainMegaethSessionChannel(
  client: Client,
  escrowContract: Address,
  channelId: Hex,
): Promise<OnChainMegaethSessionChannel> {
  return readContract(client, {
    abi: megaethSessionEscrowAbi,
    address: escrowContract,
    args: [channelId],
    functionName: "getChannel",
  });
}

export async function getMegaethErc20Balance(
  client: Client,
  token: Address,
  account: Address,
) {
  return readContract(client, {
    abi: megaethErc20Abi,
    address: token,
    args: [account],
    functionName: "balanceOf",
  });
}

export async function getMegaethErc20Allowance(
  client: Client,
  token: Address,
  owner: Address,
  spender: Address,
) {
  return readContract(client, {
    abi: megaethErc20Abi,
    address: token,
    args: [owner, spender],
    functionName: "allowance",
  });
}

export function getMegaethSessionAuthorizedSigner(
  channel: OnChainMegaethSessionChannel,
) {
  return channel.authorizedSigner === zeroAddress
    ? channel.payer
    : channel.authorizedSigner;
}

export function hydrateMegaethSessionChannelState(parameters: {
  chainId: number;
  channelId: Hex;
  escrowContract: Address;
  onChain: OnChainMegaethSessionChannel;
}) {
  const { chainId, channelId, escrowContract, onChain } = parameters;

  return {
    authorizedSigner: getMegaethSessionAuthorizedSigner(onChain),
    chainId,
    channelId,
    closeRequestedAt: onChain.closeRequestedAt,
    createdAt: new Date().toISOString(),
    deposit: onChain.deposit,
    escrowContract,
    finalized: onChain.finalized,
    highestVoucherAmount: onChain.settled,
    payee: onChain.payee,
    payer: onChain.payer,
    settledOnChain: onChain.settled,
    spent: onChain.settled,
    token: onChain.token,
    units: 0,
  } satisfies MegaethSessionChannelState;
}

export function validateMegaethSessionChannel(parameters: {
  currency: Address;
  onChain: OnChainMegaethSessionChannel;
  recipient: Address;
}) {
  const { currency, onChain, recipient } = parameters;

  if (onChain.deposit === BigInt(0)) {
    throw new Error("channel not funded on-chain");
  }

  if (onChain.finalized) {
    throw new Error("channel is finalized on-chain");
  }

  if (onChain.closeRequestedAt !== BigInt(0)) {
    throw new Error("channel has a pending close request");
  }

  if (onChain.payee.toLowerCase() !== recipient.toLowerCase()) {
    throw new Error("on-chain payee does not match the configured recipient");
  }

  if (onChain.token.toLowerCase() !== currency.toLowerCase()) {
    throw new Error("on-chain token does not match the configured currency");
  }
}

export function createMegaethSessionSource(chainId: number, address: Address) {
  return `did:pkh:eip155:${chainId}:${address}`;
}

export async function signMegaethSessionVoucher(parameters: {
  account: Account;
  chainId: number;
  channelId: Hex;
  client: Client;
  cumulativeAmount: bigint;
  escrowContract: Address;
}) {
  const {
    account,
    chainId,
    channelId,
    client,
    cumulativeAmount,
    escrowContract,
  } = parameters;

  return signTypedData(client, {
    account,
    domain: {
      chainId,
      name: "Tempo Stream Channel",
      verifyingContract: escrowContract,
      version: "1",
    },
    message: {
      channelId,
      cumulativeAmount,
    },
    primaryType: "Voucher",
    types: voucherTypes,
  });
}

export async function verifyMegaethSessionVoucher(parameters: {
  chainId: number;
  escrowContract: Address;
  expectedSigner: Address;
  voucher: SessionVoucher;
}) {
  const { chainId, escrowContract, expectedSigner, voucher } = parameters;

  try {
    const recovered = await recoverTypedDataAddress({
      domain: {
        chainId,
        name: "Tempo Stream Channel",
        verifyingContract: escrowContract,
        version: "1",
      },
      message: {
        channelId: voucher.channelId,
        cumulativeAmount: voucher.cumulativeAmount,
      },
      primaryType: "Voucher",
      signature: voucher.signature,
      types: voucherTypes,
    });

    return recovered.toLowerCase() === expectedSigner.toLowerCase();
  } catch {
    return false;
  }
}

const permit2OpenWitnessTypes = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "OpenChannelWitness" },
  ],
  OpenChannelWitness: [
    { name: "payee", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "authorizedSigner", type: "address" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

const permit2TopUpWitnessTypes = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "TopUpWitness" },
  ],
  TopUpWitness: [{ name: "channelId", type: "bytes32" }],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

type Permit2OpenSigParams = {
  amount: bigint;
  authorizedSigner: Address;
  chainId: number;
  deadline: bigint;
  nonce: bigint;
  payee: Address;
  salt: Hex;
  spender: Address;
  token: Address;
};

type Permit2TopUpSigParams = {
  amount: bigint;
  chainId: number;
  channelId: Hex;
  deadline: bigint;
  nonce: bigint;
  spender: Address;
  token: Address;
};

export function buildPermit2OpenTypedData(p: Permit2OpenSigParams) {
  return {
    domain: {
      chainId: p.chainId,
      name: "Permit2",
      verifyingContract: PERMIT2_ADDRESS,
    },
    message: {
      permitted: { token: p.token, amount: p.amount },
      spender: p.spender,
      nonce: p.nonce,
      deadline: p.deadline,
      witness: {
        payee: p.payee,
        salt: p.salt,
        authorizedSigner: p.authorizedSigner,
      },
    },
    primaryType: "PermitWitnessTransferFrom" as const,
    types: permit2OpenWitnessTypes,
  };
}

export async function signPermit2OpenWitnessTransfer(parameters: {
  account: Account;
  client: Client;
} & Permit2OpenSigParams) {
  const { account, client, ...rest } = parameters;
  return signTypedData(client, {
    account,
    ...buildPermit2OpenTypedData(rest),
  });
}

export async function recoverPermit2OpenSigner(parameters: {
  signature: Hex;
} & Permit2OpenSigParams) {
  const { signature, ...rest } = parameters;
  return recoverTypedDataAddress({
    ...buildPermit2OpenTypedData(rest),
    signature,
  });
}

export function buildPermit2TopUpTypedData(p: Permit2TopUpSigParams) {
  return {
    domain: {
      chainId: p.chainId,
      name: "Permit2",
      verifyingContract: PERMIT2_ADDRESS,
    },
    message: {
      permitted: { token: p.token, amount: p.amount },
      spender: p.spender,
      nonce: p.nonce,
      deadline: p.deadline,
      witness: { channelId: p.channelId },
    },
    primaryType: "PermitWitnessTransferFrom" as const,
    types: permit2TopUpWitnessTypes,
  };
}

export async function signPermit2TopUpWitnessTransfer(parameters: {
  account: Account;
  client: Client;
} & Permit2TopUpSigParams) {
  const { account, client, ...rest } = parameters;
  return signTypedData(client, {
    account,
    ...buildPermit2TopUpTypedData(rest),
  });
}

export async function recoverPermit2TopUpSigner(parameters: {
  signature: Hex;
} & Permit2TopUpSigParams) {
  const { signature, ...rest } = parameters;
  return recoverTypedDataAddress({
    ...buildPermit2TopUpTypedData(rest),
    signature,
  });
}
