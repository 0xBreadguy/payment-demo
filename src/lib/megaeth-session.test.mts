import assert from "node:assert/strict";
import test from "node:test";

const { buildPermit2TopUpTypedData, megaethSessionEscrowAbi } = (await import(
  new URL("./megaeth-session.ts", import.meta.url).href
)) as typeof import("./megaeth-session");

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

test("MegaETH session escrow ABI exposes Permit2 topUp relayer entrypoint", () => {
  const topUpWithPermit2 = megaethSessionEscrowAbi.find(
    (item) => item.type === "function" && item.name === "topUpWithPermit2",
  );

  assert.ok(
    topUpWithPermit2,
    "expected topUpWithPermit2(bytes32,uint256,uint256,uint256,bytes) in escrow ABI",
  );
  assert.deepEqual(
    topUpWithPermit2.inputs.map((input) => input.type),
    ["bytes32", "uint256", "uint256", "uint256", "bytes"],
  );
  assert.equal(topUpWithPermit2.stateMutability, "nonpayable");
});

test("Permit2 top-up typed data matches fixed contract witness type order", () => {
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
    "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,TopUpWitness witness)TokenPermissions(address token,uint256 amount)TopUpWitness(bytes32 channelId)",
  );
});
