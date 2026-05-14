import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const permit20ModuleUrl = new URL("./mpp-permit20.ts", import.meta.url).href;

test("recovers the owner from an EIP-2612 permit20 signature", async () => {
  const {
    buildPermit20TypedData,
    recoverPermit20Signer,
  } = (await import(permit20ModuleUrl)) as typeof import("./mpp-permit20");

  const account = privateKeyToAccount(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const parameters = {
    chainId: 6343,
    deadline: BigInt(1_800_000_000),
    nonce: BigInt(7),
    owner: account.address,
    spender: "0x1111111111111111111111111111111111111111" as const,
    token: "0x2222222222222222222222222222222222222222" as const,
    tokenName: "USDm",
    tokenVersion: "1",
    value: BigInt("1000000000000000000"),
  };

  const signature = await account.signTypedData(
    buildPermit20TypedData(parameters),
  );

  const recovered = await recoverPermit20Signer({
    ...parameters,
    signature,
  });

  assert.equal(getAddress(recovered), getAddress(account.address));
});

test("normalizes permit20 charge requests for MPP challenges", async () => {
  const { permit20ChargeMethod } =
    (await import(permit20ModuleUrl)) as typeof import("./mpp-permit20");

  const parsed = permit20ChargeMethod.schema.request.parse({
    amount: "1.5",
    chainId: 6343,
    currency: "0x2222222222222222222222222222222222222222",
    decimals: 18,
    recipient: "0x3333333333333333333333333333333333333333",
    spender: "0x1111111111111111111111111111111111111111",
    tokenName: "USDm",
    tokenVersion: "1",
  });

  assert.deepEqual(parsed, {
    amount: "1500000000000000000",
    currency: "0x2222222222222222222222222222222222222222",
    methodDetails: {
      chainId: 6343,
      spender: "0x1111111111111111111111111111111111111111",
      tokenName: "USDm",
      tokenVersion: "1",
    },
    recipient: "0x3333333333333333333333333333333333333333",
  });
});

test("prefers token EIP-712 domain over x402 fallback for permit20 signing", async () => {
  const { selectPermit20Domain } =
    (await import(permit20ModuleUrl)) as typeof import("./mpp-permit20");

  const selected = selectPermit20Domain({
    fallbackName: "USDm",
    fallbackVersion: "1",
    tokenDomainName: "Mock USDm",
    tokenDomainVersion: "1",
  });

  assert.deepEqual(selected, {
    tokenName: "Mock USDm",
    tokenVersion: "1",
  });
});
