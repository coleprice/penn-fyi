import type { FeedFreshness } from "./types/gtfs";

const FRESHNESS_PREFIX = "freshness:";

export interface FreshnessNamespace {
  get<ExpectedValue = unknown>(
    key: string,
    options: { readonly type: "json" },
  ): Promise<ExpectedValue | null>;
  put(key: string, value: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function parseFreshness(value: unknown): FeedFreshness | null {
  if (
    !isRecord(value) ||
    typeof value.feed_id !== "string" ||
    typeof value.status !== "string"
  ) {
    return null;
  }

  const checkedAt = optionalString(value.checked_at);
  const lastIngested =
    optionalString(value.last_ingested) ?? optionalString(value.ingested_at);
  const etag = optionalString(value.etag);
  const lastModified =
    optionalString(value.last_modified) ??
    optionalString(value.source_modified_at);
  const versionId = optionalString(value.version_id);
  const lastQueried =
    value.last_queried === null ? null : optionalString(value.last_queried);
  const error = optionalString(value.error);

  return {
    feed_id: value.feed_id,
    status: value.status,
    ...(checkedAt === undefined ? {} : { checked_at: checkedAt }),
    ...(lastIngested === undefined ? {} : { last_ingested: lastIngested }),
    ...(etag === undefined ? {} : { etag }),
    ...(lastModified === undefined ? {} : { last_modified: lastModified }),
    ...(versionId === undefined ? {} : { version_id: versionId }),
    ...(lastQueried === undefined ? {} : { last_queried: lastQueried }),
    ...(error === undefined ? {} : { error }),
  };
}

export class FreshnessRepository {
  constructor(private readonly namespace: FreshnessNamespace) {}

  async get(feedId: string): Promise<FeedFreshness | null> {
    const value = await this.namespace.get(`${FRESHNESS_PREFIX}${feedId}`, {
      type: "json",
    });
    return parseFreshness(value);
  }

  async getMany(
    feedIds: readonly string[],
  ): Promise<ReadonlyMap<string, FeedFreshness>> {
    const entries = await Promise.all(
      feedIds.map(async (feedId) => [feedId, await this.get(feedId)] as const),
    );
    const freshness = new Map<string, FeedFreshness>();
    for (const [feedId, value] of entries) {
      if (value !== null) {
        freshness.set(feedId, value);
      }
    }
    return freshness;
  }

  async recordQueries(
    feedIds: readonly string[],
    queriedAt: string,
  ): Promise<void> {
    const uniqueIds = [...new Set(feedIds)];
    await Promise.all(
      uniqueIds.map(async (feedId) => {
        const current = await this.get(feedId);
        const next: FeedFreshness =
          current === null
            ? {
                feed_id: feedId,
                status: "missing",
                checked_at: queriedAt,
                last_queried: queriedAt,
              }
            : { ...current, last_queried: queriedAt };
        await this.namespace.put(
          `${FRESHNESS_PREFIX}${feedId}`,
          JSON.stringify(next),
        );
      }),
    );
  }
}

export interface FreshnessStore {
  getMany(
    feedIds: readonly string[],
  ): Promise<ReadonlyMap<string, FeedFreshness>>;
  recordQueries(feedIds: readonly string[], queriedAt: string): Promise<void>;
}
