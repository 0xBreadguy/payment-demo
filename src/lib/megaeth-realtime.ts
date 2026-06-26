import {
  concat,
  encodeFunctionData,
  formatTransactionReceipt,
  keccak256,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Client,
  type Hex,
  type LocalAccount,
  type TransactionReceipt,
  type TransactionSerializedGeneric,
  type Transport,
  type WalletClient,
} from "viem";
import {
  prepareTransactionRequest,
  waitForTransactionReceipt,
} from "viem/actions";

export const MEGAETH_REALTIME_SEND_RAW_TRANSACTION =
  "realtime_sendRawTransaction";

type RealtimeRpcError = Error & {
  cause?: unknown;
  code?: number;
  details?: string;
  shortMessage?: string;
};

export type SendRawTransactionRealtimeParameters = {
  serializedTransaction: TransactionSerializedGeneric;
};

type AccountParameter = Account | Address | null | undefined;

export type SendTransactionRealtimeParameters = {
  accessList?: unknown;
  account?: AccountParameter;
  authorizationList?: unknown;
  blobVersionedHashes?: unknown;
  blobs?: unknown;
  chain?: Chain | null;
  chainId?: number;
  data?: Hex;
  dataSuffix?: Hex;
  gas?: bigint;
  gasPrice?: bigint;
  kzg?: unknown;
  maxFeePerBlobGas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  to?: Address | null;
  type?: string;
  value?: bigint;
};

export type WriteContractRealtimeParameters =
  SendTransactionRealtimeParameters & {
    abi: Abi | readonly unknown[];
    address: Address;
    args?: readonly unknown[];
    functionName: string;
  };

function formatRealtimeReceipt<chain extends Chain | undefined>(
  client: Client<Transport, chain>,
  receipt: unknown,
) {
  const format =
    client.chain?.formatters?.transactionReceipt?.format ||
    formatTransactionReceipt;
  return format(receipt as never) as TransactionReceipt;
}

function assertSuccessfulRealtimeReceipt(receipt: TransactionReceipt) {
  if (receipt.status !== "success") {
    throw new Error(
      `MegaETH realtime transaction ${receipt.transactionHash} did not succeed (status: ${receipt.status})`,
    );
  }

  return receipt;
}

function isRealtimeTransactionExpired(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const rpcError = current as RealtimeRpcError;
    const message = [
      rpcError.message,
      rpcError.shortMessage,
      rpcError.details,
    ]
      .filter(Boolean)
      .join(" ");

    if (
      rpcError.code === -32000 &&
      /realtime transaction expired/i.test(message)
    ) {
      return true;
    }

    current = rpcError.cause;
  }

  return false;
}

function requireLocalAccount(account: AccountParameter): LocalAccount {
  if (account && typeof account !== "string" && account.type === "local") {
    return account;
  }
  throw new Error("MegaETH realtime transactions require a local server account");
}

function getChainId(
  client: WalletClient,
  request: { chain?: Chain | null; chainId?: number },
) {
  return request.chainId ?? request.chain?.id ?? client.chain?.id;
}

export async function sendRawTransactionRealtime<
  chain extends Chain | undefined,
>(
  client: Client<Transport, chain>,
  { serializedTransaction }: SendRawTransactionRealtimeParameters,
): Promise<TransactionReceipt> {
  try {
    const receipt = await client.request(
      {
        method: MEGAETH_REALTIME_SEND_RAW_TRANSACTION,
        params: [serializedTransaction],
      } as never,
      { retryCount: 0 },
    );
    return assertSuccessfulRealtimeReceipt(formatRealtimeReceipt(client, receipt));
  } catch (error) {
    if (!isRealtimeTransactionExpired(error)) {
      throw error;
    }

    const receipt = await waitForTransactionReceipt(client, {
      hash: keccak256(serializedTransaction),
    });
    return assertSuccessfulRealtimeReceipt(receipt as TransactionReceipt);
  }
}

export async function sendTransactionRealtime<
  chain extends Chain | undefined,
  account extends Account | undefined,
>(
  client: WalletClient<Transport, chain, account>,
  parameters: SendTransactionRealtimeParameters,
): Promise<TransactionReceipt> {
  const {
    account: accountParameter = client.account,
    data,
    dataSuffix = typeof client.dataSuffix === "string"
      ? client.dataSuffix
      : client.dataSuffix?.value,
    ...request
  } = parameters;
  const account = requireLocalAccount(accountParameter);
  const chainId = getChainId(client as WalletClient, request);
  const prepared = await prepareTransactionRequest(client, {
    ...request,
    ...(typeof chainId === "number" ? { chainId } : {}),
    account,
    data: dataSuffix ? concat([data ?? "0x", dataSuffix]) : data,
  } as never);
  const serializedTransaction = await account.signTransaction(prepared as never, {
    serializer: client.chain?.serializers?.transaction,
  });

  return sendRawTransactionRealtime(client, { serializedTransaction });
}

export async function writeContractRealtime<
  chain extends Chain | undefined,
  account extends Account | undefined,
>(
  client: WalletClient<Transport, chain, account>,
  parameters: WriteContractRealtimeParameters,
): Promise<TransactionReceipt> {
  const {
    abi,
    account: accountParameter = client.account,
    address,
    args,
    dataSuffix,
    functionName,
    ...request
  } = parameters;
  const account = requireLocalAccount(accountParameter);
  const data = encodeFunctionData({
    abi,
    args,
    functionName,
  } as never);

  return sendTransactionRealtime(client, {
    ...request,
    account,
    data: dataSuffix ? concat([data, dataSuffix]) : data,
    to: address,
  } as never);
}
