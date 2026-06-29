import assert from "node:assert/strict";
import test from "node:test";

const {
  buildMegaethSessionVoucherTypedData,
  buildPermit2OpenTypedData,
  buildPermit2TopUpTypedData,
  megaethSessionEscrowAbi,
} = (await import(new URL("./megaeth-session.ts", import.meta.url).href)) as
  typeof import("./megaeth-session");

function encodeType(parameters: {
  primaryType: string;
  types: Record<string, readonly { name: string; type: string }[]>;
}) {
  const dependencies = new Set<string>();
  const visit = (type: string) => {
    const baseType = type.match(/^\w*/u)?.[0];
    if (!baseType || dependencies.has(baseType) || !parameters.types[baseType]) {
      return;
    }
    dependencies.add(baseType);
    for (const field of parameters.types[baseType]) visit(field.type);
  };

  visit(parameters.primaryType);
  dependencies.delete(parameters.primaryType);

  return [parameters.primaryType, ...Array.from(dependencies).sort()]
    .map(
      (type) =>
        `${type}(${parameters.types[type]
          .map((field) => `${field.type} ${field.name}`)
          .join(",")})`,
    )
    .join("");
}

test("MegaETH session escrow ABI exposes spec-shaped Permit2 relayer entrypoints", () => {
  const openWithPermit2 = megaethSessionEscrowAbi.find(
    (item) => item.type === "function" && item.name === "openWithPermit2",
  );
  const topUpWithPermit2 = megaethSessionEscrowAbi.find(
    (item) => item.type === "function" && item.name === "topUpWithPermit2",
  );

  assert.ok(
    openWithPermit2,
    "expected openWithPermit2(address,address,uint128,bytes32,address,address,uint256,uint256,bytes) in escrow ABI",
  );
  assert.deepEqual(
    openWithPermit2.inputs.map((input) => input.type),
    [
      "address",
      "address",
      "uint128",
      "bytes32",
      "address",
      "address",
      "uint256",
      "uint256",
      "bytes",
    ],
  );
  assert.equal(openWithPermit2.stateMutability, "nonpayable");

  assert.ok(
    topUpWithPermit2,
    "expected topUpWithPermit2(bytes32,uint128,address,uint256,uint256,bytes) in escrow ABI",
  );
  assert.deepEqual(
    topUpWithPermit2.inputs.map((input) => input.type),
    ["bytes32", "uint128", "address", "uint256", "uint256", "bytes"],
  );
  assert.equal(topUpWithPermit2.stateMutability, "nonpayable");
});

test("MegaETH session escrow ABI exposes spec-shaped EIP-3009 entrypoints", () => {
  const openWithAuthorization = megaethSessionEscrowAbi.find(
    (item) =>
      item.type === "function" && item.name === "openWithAuthorization",
  );
  const topUpWithAuthorization = megaethSessionEscrowAbi.find(
    (item) =>
      item.type === "function" && item.name === "topUpWithAuthorization",
  );

  assert.ok(openWithAuthorization, "expected openWithAuthorization in ABI");
  assert.deepEqual(
    openWithAuthorization.inputs.map((input) => input.type),
    [
      "address",
      "address",
      "uint128",
      "bytes32",
      "address",
      "address",
      "uint256",
      "uint256",
      "bytes32",
      "bytes",
    ],
  );

  assert.ok(topUpWithAuthorization, "expected topUpWithAuthorization in ABI");
  assert.deepEqual(
    topUpWithAuthorization.inputs.map((input) => input.type),
    [
      "bytes32",
      "uint128",
      "address",
      "bytes32",
      "uint256",
      "uint256",
      "bytes32",
      "bytes",
    ],
  );
});

test("MegaETH session escrow ABI exposes official open and topUp entrypoints", () => {
  const open = megaethSessionEscrowAbi.find(
    (item) => item.type === "function" && item.name === "open",
  );
  const topUp = megaethSessionEscrowAbi.find(
    (item) => item.type === "function" && item.name === "topUp",
  );

  assert.ok(
    open,
    "expected open(address,address,uint128,bytes32,address) in escrow ABI",
  );
  assert.deepEqual(
    open.inputs.map((input) => input.type),
    ["address", "address", "uint128", "bytes32", "address"],
  );
  assert.equal(open.stateMutability, "nonpayable");

  assert.ok(topUp, "expected topUp(bytes32,uint128) in escrow ABI");
  assert.deepEqual(
    topUp.inputs.map((input) => input.type),
    ["bytes32", "uint128"],
  );
  assert.equal(topUp.stateMutability, "nonpayable");
});

test("Permit2 open typed data uses the spec ChannelOpenWitness name", () => {
  const typedData = buildPermit2OpenTypedData({
    amount: BigInt(1),
    authorizedSigner: "0x4444444444444444444444444444444444444444",
    chainId: 6343,
    deadline: BigInt(4),
    nonce: BigInt(3),
    payee: "0x3333333333333333333333333333333333333333",
    salt: "0x1111111111111111111111111111111111111111111111111111111111111111",
    spender: "0x2724f2eEDB52487c81Ed0D20Fb2508B8597B5269",
    token: "0x15e9f2B0A747aC05c7446559306687085D161e5C",
  });

  assert.equal(
    encodeType(typedData),
    "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,ChannelOpenWitness witness)ChannelOpenWitness(address payee,bytes32 salt,address authorizedSigner)TokenPermissions(address token,uint256 amount)",
  );
});

test("Permit2 top-up typed data uses the spec ChannelTopUpWitness name", () => {
  const typedData = buildPermit2TopUpTypedData({
    amount: BigInt(1),
    chainId: 6343,
    channelId:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    deadline: BigInt(3),
    nonce: BigInt(2),
    spender: "0x2724f2eEDB52487c81Ed0D20Fb2508B8597B5269",
    token: "0x15e9f2B0A747aC05c7446559306687085D161e5C",
  });

  assert.equal(
    encodeType(typedData),
    "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,ChannelTopUpWitness witness)ChannelTopUpWitness(bytes32 channelId)TokenPermissions(address token,uint256 amount)",
  );
});

test("MegaETH session voucher typed data uses the EVM Payment Channel domain", () => {
  const typedData = buildMegaethSessionVoucherTypedData({
    chainId: 6343,
    channelId:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    cumulativeAmount: BigInt(1),
    escrowContract: "0x2724f2eEDB52487c81Ed0D20Fb2508B8597B5269",
  });

  assert.deepEqual(typedData.domain, {
    chainId: 6343,
    name: "EVM Payment Channel",
    verifyingContract: "0x2724f2eEDB52487c81Ed0D20Fb2508B8597B5269",
    version: "1",
  });
});
