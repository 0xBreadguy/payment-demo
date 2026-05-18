import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("./usdm-permit2-approval.ts", import.meta.url).href;

test("marks Permit2 approval complete when allowance covers x402 and MPP session usage", async () => {
  const {
    getPermit2ApprovalUiState,
    USDM_PERMIT2_PAYMENT_ALLOWANCE_THRESHOLD,
  } = (await import(moduleUrl)) as typeof import("./usdm-permit2-approval");

  const state = getPermit2ApprovalUiState({
    allowance: USDM_PERMIT2_PAYMENT_ALLOWANCE_THRESHOLD,
    isConnected: true,
    isPending: false,
  });

  assert.equal(state.isComplete, true);
  assert.equal(state.disabled, true);
  assert.equal(state.buttonLabel, "Permit2 allowance set");
  assert.match(state.description, /optional but recommended/i);
  assert.match(state.description, /MPP sessions/i);
  assert.match(state.description, /one fewer signature/i);
});

test("keeps recommended optional Permit2 approval interactive before allowance is set", async () => {
  const { getPermit2ApprovalUiState } =
    (await import(moduleUrl)) as typeof import("./usdm-permit2-approval");

  const state = getPermit2ApprovalUiState({
    allowance: 0n,
    isConnected: true,
    isPending: false,
  });

  assert.equal(state.isComplete, false);
  assert.equal(state.disabled, false);
  assert.equal(state.buttonLabel, "Approve Permit2 (optional but recommended)");
  assert.match(state.description, /optional but recommended/i);
  assert.match(state.description, /MPP sessions/i);
  assert.match(state.description, /one fewer signature/i);
});

test("formats very large Permit2 allowances as unlimited", async () => {
  const {
    formatPermit2AllowanceLabel,
    USDM_PERMIT2_APPROVAL_AMOUNT,
  } = (await import(moduleUrl)) as typeof import("./usdm-permit2-approval");

  assert.equal(
    formatPermit2AllowanceLabel({
      allowance: USDM_PERMIT2_APPROVAL_AMOUNT,
      decimals: 18,
      symbol: "USDm",
    }),
    "Unlimited",
  );
});

test("keeps Permit2 allowance labels compact for regular amounts", async () => {
  const { formatPermit2AllowanceLabel } =
    (await import(moduleUrl)) as typeof import("./usdm-permit2-approval");

  assert.equal(
    formatPermit2AllowanceLabel({
      allowance: BigInt("1234567891234567890"),
      decimals: 18,
      symbol: "USDm",
    }),
    "1.2345 USDm",
  );
});
