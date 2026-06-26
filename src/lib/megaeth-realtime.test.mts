import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, parseAbi, type LocalAccount, type WalletClient } from "viem";

const realtimeModuleUrl = new URL("./megaeth-realtime.ts", import.meta.url).href;
const chainModuleUrl = new URL("./chain.ts", import.meta.url).href;

function rpcReceipt(hash: `0x${string}`, status: "0x0" | "0x1" = "0x1") {
  return {
    blockHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    blockNumber: "0x10",
    contractAddress: null,
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    from: "0x0000000000000000000000000000000000000001",
    gasUsed: "0x5208",
    logs: [],
    logsBloom: "0x" + "0".repeat(512),
    status,
    to: "0x0000000000000000000000000000000000000002",
    transactionHash: hash,
    transactionIndex: "0x0",
    type: "0x2",
  };
}

test("sends raw transactions with MegaETH realtime RPC and returns the receipt", async () => {
  const { sendRawTransactionRealtime, MEGAETH_REALTIME_SEND_RAW_TRANSACTION } =
    (await import(realtimeModuleUrl)) as typeof import("./megaeth-realtime");

  const calls: unknown[] = [];
  const hash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
  const client = {
    chain: undefined,
    async request(request: unknown, options: unknown) {
      calls.push({ request, options });
      return rpcReceipt(hash);
    },
  };

  const receipt = await sendRawTransactionRealtime(client as never, {
    serializedTransaction: "0x02f8",
  });

  assert.equal(receipt.transactionHash, hash);
  assert.equal(receipt.blockNumber, BigInt(16));
  assert.equal(receipt.status, "success");
  assert.deepEqual(calls, [
    {
      request: {
        method: MEGAETH_REALTIME_SEND_RAW_TRANSACTION,
        params: ["0x02f8"],
      },
      options: { retryCount: 0 },
    },
  ]);
});

test("rejects realtime RPC receipts whose status is reverted", async () => {
  const { sendRawTransactionRealtime } =
    (await import(realtimeModuleUrl)) as typeof import("./megaeth-realtime");

  const hash =
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as const;
  const client = {
    chain: undefined,
    async request() {
      return rpcReceipt(hash, "0x0");
    },
  };

  await assert.rejects(
    sendRawTransactionRealtime(client as never, {
      serializedTransaction: "0x02f8",
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes(hash) &&
      /reverted/i.test(error.message),
  );
});

test("writes contracts by signing locally and submitting through realtime RPC", async () => {
  const { writeContractRealtime, MEGAETH_REALTIME_SEND_RAW_TRANSACTION } =
    (await import(realtimeModuleUrl)) as typeof import("./megaeth-realtime");
  const { megaethTestnet } =
    (await import(chainModuleUrl)) as typeof import("./chain");

  const calls: unknown[] = [];
  let signedRequest: Record<string, unknown> | undefined;
  const hash =
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
  const account: LocalAccount = {
    address: "0x0000000000000000000000000000000000000001",
    publicKey: "0x",
    source: "custom",
    type: "local",
    async signMessage() {
      throw new Error("not used");
    },
    async signTransaction(transaction) {
      signedRequest = transaction as Record<string, unknown>;
      return "0x02f8";
    },
    async signTypedData() {
      throw new Error("not used");
    },
  };
  const client = {
    account,
    chain: megaethTestnet,
    uid: "megaeth-realtime-test",
    async request(request: unknown, options: unknown) {
      calls.push({ request, options });
      return rpcReceipt(hash);
    },
  } as unknown as WalletClient;

  const receipt = await writeContractRealtime(client, {
    abi: parseAbi(["function transfer(address to, uint256 amount)"]),
    account,
    address: "0x0000000000000000000000000000000000000002",
    args: ["0x0000000000000000000000000000000000000003", BigInt(12)],
    functionName: "transfer",
    gas: BigInt(100000),
    maxFeePerGas: BigInt(2),
    maxPriorityFeePerGas: BigInt(1),
    nonce: 7,
    type: "eip1559",
  });

  assert.equal(receipt.transactionHash, hash);
  assert.equal(signedRequest?.to, "0x0000000000000000000000000000000000000002");
  assert.equal(signedRequest?.chainId, 6343);
  assert.equal(signedRequest?.nonce, 7);
  assert.match(String(signedRequest?.data), /^0xa9059cbb/);
  assert.deepEqual(calls, [
    {
      request: {
        method: MEGAETH_REALTIME_SEND_RAW_TRANSACTION,
        params: ["0x02f8"],
      },
      options: { retryCount: 0 },
    },
  ]);
});

test("sends locally signed transactions through realtime RPC", async () => {
  const { sendTransactionRealtime, MEGAETH_REALTIME_SEND_RAW_TRANSACTION } =
    (await import(realtimeModuleUrl)) as typeof import("./megaeth-realtime");
  const { megaethTestnet } =
    (await import(chainModuleUrl)) as typeof import("./chain");

  const calls: unknown[] = [];
  let signedRequest: Record<string, unknown> | undefined;
  const hash =
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;
  const account: LocalAccount = {
    address: "0x0000000000000000000000000000000000000001",
    publicKey: "0x",
    source: "custom",
    type: "local",
    async signMessage() {
      throw new Error("not used");
    },
    async signTransaction(transaction) {
      signedRequest = transaction as Record<string, unknown>;
      return "0x02f901";
    },
    async signTypedData() {
      throw new Error("not used");
    },
  };
  const client = {
    account,
    chain: megaethTestnet,
    uid: "megaeth-realtime-send-test",
    async request(request: unknown, options: unknown) {
      calls.push({ request, options });
      return rpcReceipt(hash);
    },
  } as unknown as WalletClient;

  const receipt = await sendTransactionRealtime(client, {
    account,
    gas: BigInt(21000),
    maxFeePerGas: BigInt(2),
    maxPriorityFeePerGas: BigInt(1),
    nonce: 8,
    to: "0x0000000000000000000000000000000000000004",
    type: "eip1559",
    value: BigInt(12),
  });

  assert.equal(receipt.transactionHash, hash);
  assert.equal(signedRequest?.to, "0x0000000000000000000000000000000000000004");
  assert.equal(signedRequest?.chainId, 6343);
  assert.equal(signedRequest?.value, BigInt(12));
  assert.deepEqual(calls, [
    {
      request: {
        method: MEGAETH_REALTIME_SEND_RAW_TRANSACTION,
        params: ["0x02f901"],
      },
      options: { retryCount: 0 },
    },
  ]);
});

test("rejects fallback receipts whose status is reverted", async () => {
  const { sendRawTransactionRealtime, MEGAETH_REALTIME_SEND_RAW_TRANSACTION } =
    (await import(realtimeModuleUrl)) as typeof import("./megaeth-realtime");

  const serializedTransaction = "0x02f8" as const;
  const hash = keccak256(serializedTransaction);
  const client = {
    chain: undefined,
    pollingInterval: 1,
    uid: "megaeth-realtime-reverted-fallback-test",
    async request(request: { method: string; params?: unknown[] }) {
      if (request.method === MEGAETH_REALTIME_SEND_RAW_TRANSACTION) {
        const error = new Error("realtime transaction expired") as Error & {
          code: number;
        };
        error.code = -32000;
        throw error;
      }
      if (request.method === "eth_getTransactionReceipt") {
        assert.deepEqual(request.params, [hash]);
        return rpcReceipt(hash, "0x0");
      }
      throw new Error(`unexpected method ${request.method}`);
    },
  };

  await assert.rejects(
    sendRawTransactionRealtime(client as never, {
      serializedTransaction,
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes(hash) &&
      /reverted/i.test(error.message),
  );
});

test("falls back to polling when the realtime RPC expires after submission", async () => {
  const { sendRawTransactionRealtime, MEGAETH_REALTIME_SEND_RAW_TRANSACTION } =
    (await import(realtimeModuleUrl)) as typeof import("./megaeth-realtime");

  const serializedTransaction = "0x02f8" as const;
  const hash = keccak256(serializedTransaction);
  const calls: unknown[] = [];
  const client = {
    chain: undefined,
    pollingInterval: 1,
    uid: "megaeth-realtime-expiry-test",
    async request(request: { method: string; params?: unknown[] }, options: unknown) {
      calls.push({ request, options });
      if (request.method === MEGAETH_REALTIME_SEND_RAW_TRANSACTION) {
        const error = new Error("realtime transaction expired") as Error & {
          code: number;
        };
        error.code = -32000;
        throw error;
      }
      if (request.method === "eth_getTransactionReceipt") {
        assert.deepEqual(request.params, [hash]);
        return rpcReceipt(hash);
      }
      throw new Error(`unexpected method ${request.method}`);
    },
  };

  const receipt = await sendRawTransactionRealtime(client as never, {
    serializedTransaction,
  });

  assert.equal(receipt.transactionHash, hash);
  assert.equal(receipt.status, "success");
  assert.deepEqual(calls, [
    {
      request: {
        method: MEGAETH_REALTIME_SEND_RAW_TRANSACTION,
        params: [serializedTransaction],
      },
      options: { retryCount: 0 },
    },
    {
      request: {
        method: "eth_getTransactionReceipt",
        params: [hash],
      },
      options: { dedupe: true },
    },
  ]);
});
