import type { Hex } from "viem";
import type { MegaethSessionChannelState } from "./megaeth-session";

type BigIntStateField =
  | "closeRequestedAt"
  | "deposit"
  | "highestVoucherAmount"
  | "settledOnChain"
  | "spent";

export type SerializedMppSessionChannelState = Omit<
  MegaethSessionChannelState,
  BigIntStateField
> & {
  closeRequestedAt: string;
  deposit: string;
  highestVoucherAmount: string;
  settledOnChain: string;
  spent: string;
};

export type MppSessionStateStore = {
  deleteChannel(channelId: Hex): Promise<void>;
  getChannel(channelId: Hex): Promise<MegaethSessionChannelState | null>;
  mode: "memory" | "upstash";
  putChannel(
    channelId: Hex,
    state: MegaethSessionChannelState,
  ): Promise<void>;
};

export type UpstashMppSessionStoreOptions = {
  fetcher?: typeof fetch;
  keyPrefix?: string;
  token: string;
  url: string;
};

const DEFAULT_KEY_PREFIX = "mpp-session:channel:";

let cachedStore: MppSessionStateStore | null = null;
let cachedStoreKey: string | null = null;

export function serializeMppSessionChannelState(
  state: MegaethSessionChannelState,
): SerializedMppSessionChannelState {
  return {
    ...state,
    closeRequestedAt: state.closeRequestedAt.toString(),
    deposit: state.deposit.toString(),
    highestVoucherAmount: state.highestVoucherAmount.toString(),
    settledOnChain: state.settledOnChain.toString(),
    spent: state.spent.toString(),
  };
}

export function deserializeMppSessionChannelState(
  state: SerializedMppSessionChannelState,
): MegaethSessionChannelState {
  return {
    ...state,
    closeRequestedAt: BigInt(state.closeRequestedAt),
    deposit: BigInt(state.deposit),
    highestVoucherAmount: BigInt(state.highestVoucherAmount),
    settledOnChain: BigInt(state.settledOnChain),
    spent: BigInt(state.spent),
  };
}

export function createMemoryMppSessionStore(): MppSessionStateStore {
  const channels = new Map<string, SerializedMppSessionChannelState>();

  return {
    mode: "memory",
    async deleteChannel(channelId) {
      channels.delete(channelId);
    },
    async getChannel(channelId) {
      const channel = channels.get(channelId);
      return channel ? deserializeMppSessionChannelState(channel) : null;
    },
    async putChannel(channelId, state) {
      channels.set(channelId, serializeMppSessionChannelState(state));
    },
  };
}

export function createUpstashMppSessionStore(
  options: UpstashMppSessionStoreOptions,
): MppSessionStateStore {
  const baseUrl = options.url.replace(/\/+$/u, "");
  const fetcher = options.fetcher ?? fetch;
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;

  async function command<T>(redisCommand: unknown[]): Promise<T> {
    const response = await fetcher(baseUrl, {
      body: JSON.stringify(redisCommand),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: string; result?: unknown }
      | null;

    if (!response.ok || body?.error) {
      throw new Error(
        `Upstash Redis ${String(redisCommand[0])} failed: ${
          body?.error ?? response.statusText
        }`,
      );
    }

    return body?.result as T;
  }

  function key(channelId: Hex) {
    return `${keyPrefix}${channelId}`;
  }

  return {
    mode: "upstash",
    async deleteChannel(channelId) {
      await command<number>(["DEL", key(channelId)]);
    },
    async getChannel(channelId) {
      const raw = await command<string | null>(["GET", key(channelId)]);
      if (raw === null) return null;
      return deserializeMppSessionChannelState(
        JSON.parse(raw) as SerializedMppSessionChannelState,
      );
    },
    async putChannel(channelId, state) {
      await command<string>([
        "SET",
        key(channelId),
        JSON.stringify(serializeMppSessionChannelState(state)),
      ]);
    },
  };
}

export function getMppSessionStateStoreConfig():
  | {
      keyPrefix: string;
      token: string;
      url: string;
    }
  | null {
  const url =
    process.env.MPP_SESSION_STATE_REDIS_REST_URL ??
    process.env.MPP_SESSION_STATE_REDIS_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.KV_REST_API_URL;
  const token =
    process.env.MPP_SESSION_STATE_REDIS_REST_TOKEN ??
    process.env.MPP_SESSION_STATE_REDIS_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;

  return {
    keyPrefix: process.env.MPP_SESSION_STATE_KEY_PREFIX ?? DEFAULT_KEY_PREFIX,
    token,
    url,
  };
}

export function isMppSessionDurableStoreConfigured(): boolean {
  return getMppSessionStateStoreConfig() !== null;
}

export function shouldRequireDurableMppSessionStore(): boolean {
  if (process.env.MPP_SESSION_REQUIRE_DURABLE_STORE === "1") return true;
  if (process.env.MPP_SESSION_ALLOW_MEMORY_STORE === "1") return false;
  return process.env.VERCEL === "1";
}

export function getMppSessionStateStore(): MppSessionStateStore {
  const config = getMppSessionStateStoreConfig();
  const cacheKey = config
    ? `upstash:${config.url}:${config.keyPrefix}`
    : "memory";

  if (cachedStore && cachedStoreKey === cacheKey) return cachedStore;

  cachedStore = config
    ? createUpstashMppSessionStore(config)
    : createMemoryMppSessionStore();
  cachedStoreKey = cacheKey;
  return cachedStore;
}
