import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_USDM_ADDRESS ??=
  "0x15e9f2B0A747aC05c7446559306687085D161e5C";

const officialClientModuleUrl = new URL(
  "./mpp-official-session-browser-client.ts",
  import.meta.url,
).href;

test("plans official MPP session open for the first paid request", async () => {
  const { getMppOfficialSessionPaymentPlan } =
    (await import(officialClientModuleUrl)) as typeof import("./mpp-official-session-browser-client");

  assert.deepEqual(
    getMppOfficialSessionPaymentPlan({
      configuredDeposit: BigInt(10),
      requestAmount: BigInt(2),
      state: { opened: false },
    }),
    {
      action: "open",
      depositAmount: BigInt(10),
      nextCumulativeAmount: BigInt(2),
    },
  );
});

test("plans official MPP session voucher while deposit covers the next request", async () => {
  const { getMppOfficialSessionPaymentPlan } =
    (await import(officialClientModuleUrl)) as typeof import("./mpp-official-session-browser-client");

  assert.deepEqual(
    getMppOfficialSessionPaymentPlan({
      configuredDeposit: BigInt(10),
      requestAmount: BigInt(2),
      state: {
        cumulativeAmount: BigInt(4),
        depositAmount: BigInt(10),
        opened: true,
      },
    }),
    {
      action: "voucher",
      nextCumulativeAmount: BigInt(6),
    },
  );
});

test("plans official MPP session top-up when the next voucher would exceed deposit", async () => {
  const { getMppOfficialSessionPaymentPlan } =
    (await import(officialClientModuleUrl)) as typeof import("./mpp-official-session-browser-client");

  assert.deepEqual(
    getMppOfficialSessionPaymentPlan({
      configuredDeposit: BigInt(10),
      requestAmount: BigInt(2),
      state: {
        cumulativeAmount: BigInt(10),
        depositAmount: BigInt(10),
        opened: true,
      },
    }),
    {
      action: "topUp",
      additionalDeposit: BigInt(10),
      nextCumulativeAmount: BigInt(12),
    },
  );
});

test("sends official session top-up with wallet_sendTransaction before viem writeContract fallback", async () => {
  type SendWalletContractTransaction = (options: {
    abi: typeof import("./megaeth-session").megaethSessionEscrowAbi;
    account: `0x${string}`;
    address: `0x${string}`;
    args: readonly unknown[];
    functionName: "topUp";
    label: string;
    walletClient: {
      request: (request: {
        method: string;
        params: readonly [Record<string, unknown>];
      }) => Promise<`0x${string}`>;
      writeContract: () => Promise<`0x${string}`>;
    };
  }) => Promise<`0x${string}`>;

  const [
    { sendMppOfficialSessionWalletContractTransaction },
    { megaethSessionEscrowAbi },
  ] = (await Promise.all([
    import(officialClientModuleUrl),
    import(new URL("./megaeth-session.ts", import.meta.url).href),
  ])) as [
    { sendMppOfficialSessionWalletContractTransaction: SendWalletContractTransaction },
    typeof import("./megaeth-session"),
  ];

  const calls: string[] = [];
  const hash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const account = "0x1111111111111111111111111111111111111111";
  const escrow = "0x2222222222222222222222222222222222222222";
  const channelId =
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const result = await sendMppOfficialSessionWalletContractTransaction({
    abi: megaethSessionEscrowAbi,
    account,
    address: escrow,
    args: [channelId, BigInt(2)],
    functionName: "topUp",
    label: "topUp",
    walletClient: {
      async request(request) {
        calls.push(request.method);
        assert.equal(request.method, "wallet_sendTransaction");
        assert.equal(request.params[0].from, account);
        assert.equal(request.params[0].to, escrow);
        assert.match(String(request.params[0].data), /^0x/);
        return hash;
      },
      async writeContract() {
        throw new Error("writeContract should not be called");
      },
    },
  });

  assert.equal(result, hash);
  assert.deepEqual(calls, ["wallet_sendTransaction"]);
});

test("falls back to viem writeContract when wallet_sendTransaction is unsupported", async () => {
  type SendWalletContractTransaction = (options: {
    abi: typeof import("./megaeth-session").megaethSessionEscrowAbi;
    account: `0x${string}`;
    address: `0x${string}`;
    args: readonly unknown[];
    functionName: "topUp";
    label: string;
    walletClient: {
      request: () => Promise<`0x${string}`>;
      writeContract: () => Promise<`0x${string}`>;
    };
  }) => Promise<`0x${string}`>;

  const [
    { sendMppOfficialSessionWalletContractTransaction },
    { megaethSessionEscrowAbi },
  ] = (await Promise.all([
    import(officialClientModuleUrl),
    import(new URL("./megaeth-session.ts", import.meta.url).href),
  ])) as [
    { sendMppOfficialSessionWalletContractTransaction: SendWalletContractTransaction },
    typeof import("./megaeth-session"),
  ];

  const calls: string[] = [];
  const hash =
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  const unsupported = new Error("wallet namespace unsupported") as Error & {
    code: number;
    name: string;
  };
  unsupported.name = "MethodNotSupportedRpcError";
  unsupported.code = -32601;

  const result = await sendMppOfficialSessionWalletContractTransaction({
    abi: megaethSessionEscrowAbi,
    account: "0x1111111111111111111111111111111111111111",
    address: "0x2222222222222222222222222222222222222222",
    args: [
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      BigInt(2),
    ],
    functionName: "topUp",
    label: "topUp",
    walletClient: {
      async request() {
        calls.push("wallet_sendTransaction");
        throw unsupported;
      },
      async writeContract() {
        calls.push("writeContract");
        return hash;
      },
    },
  });

  assert.equal(result, hash);
  assert.deepEqual(calls, ["wallet_sendTransaction", "writeContract"]);
});
