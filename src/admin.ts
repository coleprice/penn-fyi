import type { FreshnessStore } from "./freshness";
import type { FeedRegistry } from "./types/gtfs";

interface IngestNeededOptions {
  readonly staleAfterHours: number;
  readonly recentQueryWindowDays: number;
}

interface TimingSafeSubtleCrypto extends SubtleCrypto {
  timingSafeEqual(
    left: ArrayBuffer | ArrayBufferView,
    right: ArrayBuffer | ArrayBufferView,
  ): boolean;
}

function supportsTimingSafeEqual(
  subtle: SubtleCrypto,
): subtle is TimingSafeSubtleCrypto {
  return "timingSafeEqual" in subtle;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export async function constantTimeTokenEqual(
  presented: string,
  expected: string | undefined,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const configured = typeof expected === "string" && expected.length > 0;
  const [presentedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected ?? "")),
  ]);
  if (supportsTimingSafeEqual(crypto.subtle)) {
    return (
      configured && crypto.subtle.timingSafeEqual(presentedHash, expectedHash)
    );
  }

  const presentedBytes = new Uint8Array(presentedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (const [index, presentedByte] of presentedBytes.entries()) {
    difference |= presentedByte ^ (expectedBytes[index] ?? 0);
  }
  return configured && difference === 0;
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization);
  return match?.[1] ?? "";
}

export async function ingestNeeded(
  registry: FeedRegistry,
  freshnessRepository: Pick<FreshnessStore, "getMany">,
  now: Date,
  options: IngestNeededOptions,
): Promise<Record<string, unknown>> {
  const feedIds = registry.feeds.map((feed) => feed.id);
  const freshness = await freshnessRepository.getMany(feedIds);
  const nowTime = now.getTime();
  const staleThresholdMs = options.staleAfterHours * 60 * 60 * 1_000;
  const recentThresholdMs =
    options.recentQueryWindowDays * 24 * 60 * 60 * 1_000;

  const feeds = feedIds.flatMap((feedId) => {
    const state = freshness.get(feedId);
    const queriedAt = parseTimestamp(state?.last_queried);
    if (
      queriedAt === null ||
      nowTime - queriedAt > recentThresholdMs ||
      queriedAt > nowTime
    ) {
      return [];
    }

    const ingestedAt = parseTimestamp(state?.last_ingested);
    const stale =
      ingestedAt === null ||
      nowTime - ingestedAt > staleThresholdMs ||
      state?.status === "missing" ||
      state?.status === "stale" ||
      state?.status === "changed" ||
      state?.status === "error";
    if (!stale) {
      return [];
    }

    return [
      {
        feed_id: feedId,
        reason: ingestedAt === null ? "missing" : "stale",
        last_queried: state?.last_queried ?? null,
        last_ingested: state?.last_ingested ?? null,
        checked_at: state?.checked_at ?? null,
        status: state?.status ?? "missing",
      },
    ];
  });

  return {
    needed: feeds.length > 0,
    feeds,
    data_as_of: now.toISOString(),
  };
}
