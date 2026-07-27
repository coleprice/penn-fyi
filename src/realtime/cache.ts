import type { Clock } from "../tools/service";
import type { RealtimeCacheStatus } from "./types";

const CACHE_VERSION = 1;
const MINIMUM_KV_EXPIRATION_SECONDS = 60;

export interface RealtimeCacheNamespace {
  get<ExpectedValue = unknown>(
    key: string,
    options: { readonly type: "json" },
  ): Promise<ExpectedValue | null>;
  put(
    key: string,
    value: string,
    options: { readonly expirationTtl: number },
  ): Promise<void>;
}

interface CacheEnvelope {
  readonly version: number;
  readonly fetched_at: string;
  readonly expires_at: string;
  readonly value: unknown;
}

export interface CachedLoad<T> {
  readonly value: T;
  readonly fetchedAt: string;
  readonly cacheStatus: RealtimeCacheStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelope(value: unknown): CacheEnvelope | null {
  if (
    !isRecord(value) ||
    value.version !== CACHE_VERSION ||
    typeof value.fetched_at !== "string" ||
    typeof value.expires_at !== "string"
  ) {
    return null;
  }
  if (
    Number.isNaN(Date.parse(value.fetched_at)) ||
    Number.isNaN(Date.parse(value.expires_at))
  ) {
    return null;
  }
  return {
    version: CACHE_VERSION,
    fetched_at: value.fetched_at,
    expires_at: value.expires_at,
    value: value.value,
  };
}

export class RealtimeCache {
  constructor(
    private readonly namespace: RealtimeCacheNamespace,
    private readonly ttlSeconds: number,
    private readonly clock: Clock,
  ) {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error("realtime cache TTL must be positive");
    }
  }

  async getOrLoad<T>(
    key: string,
    validate: (value: unknown) => T | null,
    load: () => Promise<T>,
  ): Promise<CachedLoad<T>> {
    const now = this.clock.now();
    let cached: unknown = null;
    try {
      cached = await this.namespace.get(key, { type: "json" });
    } catch (error) {
      console.warn({
        event: "realtime_cache_read_failed",
        key,
        error: error instanceof Error ? error.name : "unknown",
      });
    }

    const envelope = parseEnvelope(cached);
    if (envelope !== null && Date.parse(envelope.expires_at) > now.getTime()) {
      const value = validate(envelope.value);
      if (value !== null) {
        return {
          value,
          fetchedAt: envelope.fetched_at,
          cacheStatus: "hit",
        };
      }
    }

    const value = await load();
    const fetchedAt = this.clock.now();
    const expiresAt = new Date(fetchedAt.getTime() + this.ttlSeconds * 1_000);
    const next: CacheEnvelope = {
      version: CACHE_VERSION,
      fetched_at: fetchedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      value,
    };
    try {
      await this.namespace.put(key, JSON.stringify(next), {
        expirationTtl: Math.max(
          MINIMUM_KV_EXPIRATION_SECONDS,
          Math.ceil(this.ttlSeconds * 3),
        ),
      });
    } catch (error) {
      console.warn({
        event: "realtime_cache_write_failed",
        key,
        error: error instanceof Error ? error.name : "unknown",
      });
    }

    return {
      value,
      fetchedAt: fetchedAt.toISOString(),
      cacheStatus: "miss",
    };
  }
}
