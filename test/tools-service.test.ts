import { describe, expect, it } from "vitest";

import type {
  FindStopCandidatesInput,
  TransitStore,
} from "../src/data/transit-store";
import type { FreshnessStore } from "../src/freshness";
import { TransitToolService } from "../src/tools/service";
import type {
  FeedFreshness,
  FeedRegistry,
  FeedVersion,
  StopRecord,
} from "../src/types/gtfs";

const registry: FeedRegistry = {
  schema_version: 1,
  updated_at: "2026-07-23T00:00:00.000Z",
  feeds: [
    {
      id: "amtrak",
      agency_name: "Amtrak",
      region: "United States",
      adapter: "amtraker",
      priority: 1,
      status: "operational",
      source_page: "https://example.test/amtrak",
      modes: ["rail"],
      license: { status: "review_required", redistributable: false },
    },
    {
      id: "bay-area",
      agency_name: "Bay Area Transit",
      region: "San Francisco Bay Area",
      adapter: "gtfs-static",
      download_url: "https://example.test/gtfs.zip",
      priority: 2,
      status: "operational",
      source_page: "https://example.test/bay",
      modes: ["rail"],
      license: { status: "verified", redistributable: true },
    },
  ],
};

const stops: readonly StopRecord[] = [
  {
    feedId: "amtrak",
    stopId: "NYP",
    name: "New York Penn Station",
    latitude: 40.7506,
    longitude: -73.9935,
    timezone: "America/New_York",
    locationType: 1,
    parentStation: null,
    platformCode: null,
    wheelchairBoarding: 1,
  },
  {
    feedId: "bay-area",
    stopId: "SFO",
    name: "San Francisco International Airport",
    latitude: 37.616,
    longitude: -122.391,
    timezone: "America/Los_Angeles",
    locationType: 1,
    parentStation: null,
    platformCode: null,
    wheelchairBoarding: 1,
  },
];

class FakeStore implements TransitStore {
  async findStopCandidates(
    input: FindStopCandidatesInput,
  ): Promise<readonly StopRecord[]> {
    return stops
      .filter(
        (stop) =>
          stop.name.toLowerCase().includes(input.normalizedQuery) ||
          stop.stopId.toLowerCase().includes(input.normalizedQuery),
      )
      .slice(0, input.candidateLimit);
  }

  async getFeedVersions(
    feedIds: readonly string[],
  ): Promise<readonly FeedVersion[]> {
    return feedIds.map((feedId) => ({
      feedId,
      ingestedAt: "2026-07-23T14:00:00.000Z",
    }));
  }
}

class FakeFreshness {
  readonly values = new Map<string, FeedFreshness>([
    [
      "amtrak",
      {
        feed_id: "amtrak",
        status: "fresh",
        checked_at: "2026-07-23T14:05:00.000Z",
        last_ingested: "2026-07-23T14:00:00.000Z",
      },
    ],
  ]);

  async getMany(
    feedIds: readonly string[],
  ): Promise<ReadonlyMap<string, FeedFreshness>> {
    return new Map(
      feedIds.flatMap((feedId) => {
        const value = this.values.get(feedId);
        return value === undefined ? [] : [[feedId, value]];
      }),
    );
  }

  async recordQueries(
    feedIds: readonly string[],
    queriedAt: string,
  ): Promise<void> {
    for (const feedId of feedIds) {
      const current = this.values.get(feedId);
      this.values.set(feedId, {
        feed_id: feedId,
        status: current?.status ?? "missing",
        checked_at: current?.checked_at ?? queriedAt,
        ...(current?.last_ingested === undefined
          ? {}
          : { last_ingested: current.last_ingested }),
        last_queried: queriedAt,
      });
    }
  }
}

function service(freshness = new FakeFreshness()): TransitToolService {
  return new TransitToolService(registry, new FakeStore(), freshness, {
    now: () => new Date("2026-07-23T15:00:00.000Z"),
  });
}

describe("TransitToolService", () => {
  it("lists registry feeds with KV and D1 freshness", async () => {
    await expect(service().listFeeds()).resolves.toMatchObject({
      count: 2,
      data_as_of: "2026-07-23T15:00:00.000Z",
      feeds: [
        {
          id: "amtrak",
          priority: 1,
          freshness: {
            status: "fresh",
            last_ingested: "2026-07-23T14:00:00.000Z",
          },
        },
        {
          id: "bay-area",
          freshness: {
            status: "available",
            last_ingested: "2026-07-23T14:00:00.000Z",
          },
        },
      ],
    });
  });

  it("finds stops and reports the dataset version", async () => {
    const result = await service().findStops({
      query: "Penn Station",
      limit: 5,
    });

    expect(result).toMatchObject({
      count: 1,
      data_as_of: "2026-07-23T14:00:00.000Z",
      stops: [
        {
          feed_id: "amtrak",
          stop_id: "NYP",
          timezone: "America/New_York",
        },
      ],
    });
  });

  it("ranks nearby stops in kilometers and applies radius", async () => {
    const result = await service().findStops({
      query: "San",
      near: {
        latitude: 37.615,
        longitude: -122.39,
        radius_km: 10,
      },
    });

    expect(result).toMatchObject({
      count: 1,
      stops: [{ stop_id: "SFO" }],
    });
    const resultStops = result.stops;
    expect(Array.isArray(resultStops)).toBe(true);
  });

  it("returns an honest structured result for unavailable tools", () => {
    expect(service().stub("trip_status", "not implemented")).toEqual({
      status: "not_available",
      tool: "trip_status",
      reason: "not implemented",
      data_as_of: "2026-07-23T15:00:00.000Z",
    });
  });
});
