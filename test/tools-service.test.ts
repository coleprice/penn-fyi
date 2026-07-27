import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type {
  FindScheduledTripsInput,
  FindStopCandidatesInput,
  FindStopsByIdInput,
  TransitStore,
} from "../src/data/transit-store";
import type { FreshnessStore } from "../src/freshness";
import { createTransitMcpServer } from "../src/mcp";
import { TransitToolService } from "../src/tools/service";
import type {
  FeedFreshness,
  FeedRegistry,
  FeedVersion,
  ScheduledTripRecord,
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
      adapter: "gtfs-static",
      download_url: "https://example.test/amtrak.zip",
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
  {
    feedId: "bay-area",
    stopId: "901401",
    name: "Civic Center / UN Plaza",
    latitude: 37.7795,
    longitude: -122.413,
    timezone: "America/Los_Angeles",
    locationType: 0,
    parentStation: null,
    platformCode: "1",
    wheelchairBoarding: 1,
  },
  {
    feedId: "bay-area",
    stopId: "907101",
    name: "San Francisco International Airport",
    latitude: 37.616,
    longitude: -122.391,
    timezone: "America/Los_Angeles",
    locationType: 0,
    parentStation: null,
    platformCode: "1",
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

  async findStopsById(
    input: FindStopsByIdInput,
  ): Promise<readonly StopRecord[]> {
    return stops.filter(
      (stop) =>
        stop.stopId.toLowerCase() === input.stopId.toLowerCase() &&
        (input.feedId === undefined || stop.feedId === input.feedId),
    );
  }

  async findScheduledTrips(
    input: FindScheduledTripsInput,
  ): Promise<readonly ScheduledTripRecord[]> {
    if (
      input.feedId === "bay-area" &&
      input.fromStopId === "901401" &&
      input.toStopId === "907101" &&
      input.serviceDate === "20260729"
    ) {
      return [
        {
          feedId: "bay-area",
          tripId: "yellow-901",
          tripShortName: null,
          routeId: "YELLOW",
          routeShortName: "Yellow",
          routeLongName: "Antioch - SFO",
          routeType: 1,
          tripHeadsign: "San Francisco International Airport",
          directionId: 0,
          fromStopId: "901401",
          fromStopName: "Civic Center / UN Plaza",
          fromTimezone: "America/Los_Angeles",
          departureTime: "21:10:00",
          departureSeconds: 21 * 3600 + 10 * 60,
          toStopId: "907101",
          toStopName: "San Francisco International Airport",
          toTimezone: "America/Los_Angeles",
          arrivalTime: "21:40:00",
          arrivalSeconds: 21 * 3600 + 40 * 60,
        },
      ];
    }
    if (
      input.feedId !== "amtrak" ||
      input.fromStopId.toUpperCase() !== "NYP" ||
      input.toStopId?.toUpperCase() !== "HAR" ||
      input.serviceDate !== "20260729"
    ) {
      return [];
    }
    return [
      {
        feedId: "amtrak",
        tripId: "643",
        tripShortName: "643",
        routeId: "Keystone",
        routeShortName: "Keystone",
        routeLongName: "Keystone Service",
        routeType: 2,
        tripHeadsign: "Harrisburg",
        directionId: 1,
        fromStopId: "NYP",
        fromStopName: "New York Penn Station",
        fromTimezone: "America/New_York",
        departureTime: "14:15:00",
        departureSeconds: 14 * 3600 + 15 * 60,
        toStopId: "HAR",
        toStopName: "Harrisburg",
        toTimezone: "America/New_York",
        arrivalTime: "17:35:00",
        arrivalSeconds: 17 * 3600 + 35 * 60,
      },
    ];
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
          availability: "ready",
          freshness: {
            status: "fresh",
            last_ingested: "2026-07-23T14:00:00.000Z",
          },
        },
        {
          id: "bay-area",
          availability: "ready",
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
      count: 2,
      stops: [{ stop_id: "SFO" }, { stop_id: "907101" }],
    });
    const resultStops = result.stops;
    expect(Array.isArray(resultStops)).toBe(true);
  });

  it("returns dated origin-to-destination static schedule options", async () => {
    await expect(
      service().nextDepartures({
        from_stop: "NYP",
        to_stop: "HAR",
        service_date: "2026-07-29",
        feed: "amtrak",
      }),
    ).resolves.toMatchObject({
      count: 1,
      realtime_included: false,
      data_as_of: "2026-07-23T14:00:00.000Z",
      departures: [
        {
          feed_id: "amtrak",
          trip_id: "643",
          train_number: "643",
          status: "scheduled",
          origin: {
            stop_id: "NYP",
            scheduled_departure: "2026-07-29T14:15:00-04:00",
          },
          destination: {
            stop_id: "HAR",
            scheduled_arrival: "2026-07-29T17:35:00-04:00",
          },
        },
      ],
    });
  });

  it("accepts numeric stop IDs through the legacy stop alias", async () => {
    await expect(
      service().nextDepartures({
        stop: 901401,
        to_stop: 907101,
        service_date: "2026-07-29",
        feed: "bay-area",
      }),
    ).resolves.toMatchObject({
      count: 1,
      query: {
        from_stop: "901401",
        to_stop: "907101",
        feed: "bay-area",
      },
      departures: [
        {
          feed_id: "bay-area",
          origin: { stop_id: "901401" },
          destination: { stop_id: "907101" },
        },
      ],
    });
  });

  it("publishes and executes the compatible MCP stop schema", async () => {
    const server = createTransitMcpServer(service());
    const client = new Client({
      name: "penn-fyi-test",
      version: "1.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find(
        (candidate) => candidate.name === "next_departures",
      );
      expect(tool?.inputSchema.properties).toMatchObject({
        from_stop: {},
        stop: {},
        to_stop: {},
      });
      expect(tool?.inputSchema.properties?.from_stop).toMatchObject({
        anyOf: [{ type: "string" }, { type: "integer" }],
      });
      expect(tool?.inputSchema.required ?? []).not.toContain("from_stop");

      const call = await client.callTool({
        name: "next_departures",
        arguments: {
          stop: 901401,
          to_stop: 907101,
          service_date: "2026-07-29",
          feed: "bay-area",
        },
      });
      expect(call.isError).not.toBe(true);
      expect(call).toMatchObject({
        structuredContent: {
          count: 1,
          query: {
            from_stop: "901401",
            to_stop: "907101",
          },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("resolves feed-qualified compound stop references", async () => {
    await expect(
      service().nextDepartures({
        from_stop: "bay-area:901401",
        to_stop: "bay-area:907101",
        service_date: "2026-07-29",
      }),
    ).resolves.toMatchObject({
      count: 1,
      query: {
        from_stop: "901401",
        to_stop: "907101",
        feed: "bay-area",
      },
    });
  });

  it("rejects conflicting feed-qualified stop references", async () => {
    await expect(
      service().nextDepartures({
        from_stop: "amtrak:NYP",
        to_stop: "bay-area:907101",
        service_date: "2026-07-29",
      }),
    ).rejects.toThrow(/same feed/);
  });

  it("rejects inverted schedule windows", async () => {
    await expect(
      service().nextDepartures({
        from_stop: "NYP",
        service_date: "2026-07-29",
        after_time: "18:00",
        before_time: "08:00",
      }),
    ).rejects.toThrow(/before_time/);
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
