import type { TransitStore } from "../data/transit-store";
import type { FreshnessStore } from "../freshness";
import type { FeedDefinition, FeedRegistry, StopRecord } from "../types/gtfs";

export interface Clock {
  now(): Date;
}

export interface NearPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly radius_km?: number | undefined;
}

export interface FindStopsInput {
  readonly query: string;
  readonly near?: NearPoint | undefined;
  readonly limit?: number | undefined;
}

export interface StubToolResult extends Readonly<Record<string, unknown>> {
  readonly status: "not_available";
  readonly tool: string;
  readonly reason: string;
  readonly data_as_of: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_NEAR_CANDIDATES = 250;
const EARTH_RADIUS_KM = 6_371.0088;

function toIso(date: Date): string {
  return date.toISOString();
}

function latestIso(values: readonly (string | undefined)[]): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const time = Date.parse(value);
    if (!Number.isNaN(time) && time > latestTime) {
      latest = new Date(time).toISOString();
      latestTime = time;
    }
  }
  return latest;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function publicFeed(feed: FeedDefinition): Record<string, unknown> {
  return {
    id: feed.id,
    agency: feed.agency_name,
    region: feed.region,
    adapter: feed.adapter,
    priority: feed.priority,
    status: feed.status,
    modes: feed.modes,
    has_static_schedule: feed.download_url !== undefined,
    has_realtime: feed.realtime !== undefined,
    redistributable: feed.license.redistributable,
  };
}

function publicStop(
  stop: StopRecord,
  distance: number | null,
): Record<string, unknown> {
  return {
    feed_id: stop.feedId,
    stop_id: stop.stopId,
    name: stop.name,
    latitude: stop.latitude,
    longitude: stop.longitude,
    timezone: stop.timezone,
    location_type: stop.locationType,
    parent_station: stop.parentStation,
    platform_code: stop.platformCode,
    wheelchair_boarding: stop.wheelchairBoarding,
    ...(distance === null
      ? {}
      : { distance_km: Math.round(distance * 1_000) / 1_000 }),
  };
}

export class TransitToolService {
  constructor(
    private readonly registry: FeedRegistry,
    private readonly store: TransitStore,
    private readonly freshness: FreshnessStore,
    private readonly clock: Clock,
  ) {}

  async listFeeds(): Promise<Record<string, unknown>> {
    const feedIds = this.registry.feeds.map((feed) => feed.id);
    const [freshnessByFeed, versions] = await Promise.all([
      this.freshness.getMany(feedIds),
      this.store.getFeedVersions(feedIds),
    ]);
    const versionByFeed = new Map(
      versions.map((version) => [version.feedId, version.ingestedAt]),
    );

    const feeds = this.registry.feeds.map((feed) => {
      const freshness = freshnessByFeed.get(feed.id);
      const ingestedAt = freshness?.last_ingested ?? versionByFeed.get(feed.id);
      return {
        ...publicFeed(feed),
        freshness: {
          status: freshness?.status ?? (ingestedAt ? "available" : "missing"),
          checked_at: freshness?.checked_at ?? null,
          last_ingested: ingestedAt ?? null,
          last_modified: freshness?.last_modified ?? null,
          last_queried: freshness?.last_queried ?? null,
          error: freshness?.error ?? null,
        },
      };
    });

    return {
      feeds,
      count: feeds.length,
      data_as_of: toIso(this.clock.now()),
    };
  }

  async findStops(input: FindStopsInput): Promise<Record<string, unknown>> {
    const normalizedQuery = input.query.trim().toLocaleLowerCase("en-US");
    if (normalizedQuery.length < 2) {
      throw new Error(
        "query must contain at least two non-whitespace characters",
      );
    }

    const limit = Math.min(
      Math.max(input.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const candidates = await this.store.findStopCandidates({
      normalizedQuery,
      candidateLimit:
        input.near === undefined
          ? limit
          : Math.min(Math.max(limit * 10, 100), MAX_NEAR_CANDIDATES),
    });

    const ranked = candidates
      .map((stop) => {
        const distance =
          input.near !== undefined &&
          stop.latitude !== null &&
          stop.longitude !== null
            ? distanceKm(
                input.near.latitude,
                input.near.longitude,
                stop.latitude,
                stop.longitude,
              )
            : null;
        return { stop, distance };
      })
      .filter(
        ({ distance }) =>
          input.near?.radius_km === undefined ||
          (distance !== null && distance <= input.near.radius_km),
      )
      .sort((left, right) => {
        if (input.near === undefined) {
          return 0;
        }
        return (
          (left.distance ?? Number.POSITIVE_INFINITY) -
          (right.distance ?? Number.POSITIVE_INFINITY)
        );
      })
      .slice(0, limit);

    const feedIds = [...new Set(ranked.map(({ stop }) => stop.feedId))];
    const versions = await this.store.getFeedVersions(feedIds);
    const queriedAt = toIso(this.clock.now());
    await this.freshness.recordQueries(feedIds, queriedAt);

    return {
      stops: ranked.map(({ stop, distance }) => publicStop(stop, distance)),
      count: ranked.length,
      query: input.query.trim(),
      near: input.near ?? null,
      data_as_of: latestIso(versions.map((version) => version.ingestedAt)),
    };
  }

  stub(tool: string, reason: string): StubToolResult {
    return {
      status: "not_available",
      tool,
      reason,
      data_as_of: toIso(this.clock.now()),
    };
  }
}
