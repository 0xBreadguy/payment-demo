import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const approvalModuleUrl = new URL(
  "./mpp-session-permit20-approval.ts",
  import.meta.url,
).href;
const permit20ModuleUrl = new URL("./mpp-permit20.ts", import.meta.url).href;
const sessionModuleUrl = new URL("./megaeth-session.ts", import.meta.url).href;

test("builds a USDm permit payload that approves Permit2 for a session deposit", async () => {
  const {
    buildMppSessionPermit20ApprovalPayload,
    recoverMppSessionPermit20ApprovalSigner,
  } = (await import(approvalModuleUrl)) as typeof import("./mpp-session-permit20-approval");
  const { buildPermit20TypedData } =
    (await import(permit20ModuleUrl)) as typeof import("./mpp-permit20");
  const { PERMIT2_ADDRESS } =
    (await import(sessionModuleUrl)) as typeof import("./megaeth-session");

  const account = privateKeyToAccount(
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  const parameters = {
    chainId: 6343,
    deadline: BigInt(1_800_000_000),
    nonce: BigInt(9),
    owner: account.address,
    spender: PERMIT2_ADDRESS,
    token: "0x2222222222222222222222222222222222222222" as const,
    tokenName: "USDm",
    tokenVersion: "1",
    value: BigInt("10000000000000000000"),
  };

  const signature = await account.signTypedData(
    buildPermit20TypedData(parameters),
  );

  const payload = buildMppSessionPermit20ApprovalPayload({
    deadline: parameters.deadline,
    nonce: parameters.nonce,
    owner: account.address,
    signature,
    value: parameters.value,
  });

  assert.equal(getAddress(payload.owner), getAddress(account.address));
  assert.equal(getAddress(payload.spender), getAddress(PERMIT2_ADDRESS));
  assert.equal(payload.value, parameters.value.toString());
  assert.equal(payload.type, "permit20");

  const recovered = await recoverMppSessionPermit20ApprovalSigner({
    chainId: parameters.chainId,
    payload,
    token: parameters.token,
    tokenName: parameters.tokenName,
    tokenVersion: parameters.tokenVersion,
  });

  assert.equal(getAddress(recovered), getAddress(account.address));
});

test("validates the session permit20 approval fields before sponsorship", async () => {
  const {
    buildMppSessionPermit20ApprovalPayload,
    getMppSessionPermit20ApprovalIssue,
  } = (await import(approvalModuleUrl)) as typeof import("./mpp-session-permit20-approval");

  const owner = "0x1111111111111111111111111111111111111111" as const;
  const payload = buildMppSessionPermit20ApprovalPayload({
    deadline: BigInt(1_800_000_000),
    nonce: BigInt(3),
    owner,
    signature: "0x1234",
    value: BigInt(10),
  });

  assert.equal(
    getMppSessionPermit20ApprovalIssue(payload, {
      expectedOwner: owner,
      nowSeconds: BigInt(1_700_000_000),
      requiredValue: BigInt(10),
    }),
    null,
  );

  assert.match(
    getMppSessionPermit20ApprovalIssue(
      { ...payload, value: "9" },
      {
        expectedOwner: owner,
        nowSeconds: BigInt(1_700_000_000),
        requiredValue: BigInt(10),
      },
    ) ?? "",
    /does not match required/,
  );

  assert.match(
    getMppSessionPermit20ApprovalIssue(
      { ...payload, deadline: "1699999999" },
      {
        expectedOwner: owner,
        nowSeconds: BigInt(1_700_000_000),
        requiredValue: BigInt(10),
      },
    ) ?? "",
    /expired/,
  );
});
