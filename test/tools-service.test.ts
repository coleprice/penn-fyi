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
import type {
  RealtimeTrainStatus,
  RealtimeTripLookup,
  RealtimeTripProvider,
} from "../src/realtime/types";
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

const realtimeTrain: RealtimeTrainStatus = {
  trainId: "43-23",
  trainNumber: "43",
  routeName: "Pennsylvanian",
  serviceDate: "2026-07-23",
  trainState: "Active",
  origin: {
    stopId: "NYP",
    name: "New York Penn",
    timezone: "America/New_York",
  },
  destination: {
    stopId: "PGH",
    name: "Pittsburgh",
    timezone: "America/New_York",
  },
  currentEvent: {
    stopId: "HGD",
    name: "Huntingdon",
    timezone: "America/New_York",
  },
  latitude: 40.56,
  longitude: -77.59,
  heading: "SW",
  speedMph: 62.3,
  statusMessage: null,
  observedAt: "2026-07-23T10:59:10-04:00",
  updatedAt: "2026-07-23T10:59:47-04:00",
  stations: [
    {
      stopId: "NYP",
      name: "New York Penn",
      timezone: "America/New_York",
      status: "Departed",
      scheduledArrival: "2026-07-23T08:00:00-04:00",
      reportedArrival: "2026-07-23T08:00:00-04:00",
      scheduledDeparture: "2026-07-23T08:00:00-04:00",
      reportedDeparture: "2026-07-23T08:00:00-04:00",
      platform: "Track 7",
    },
    {
      stopId: "HGD",
      name: "Huntingdon",
      timezone: "America/New_York",
      status: "Enroute",
      scheduledArrival: "2026-07-23T10:48:00-04:00",
      reportedArrival: "2026-07-23T10:59:00-04:00",
      scheduledDeparture: "2026-07-23T10:50:00-04:00",
      reportedDeparture: "2026-07-23T11:01:00-04:00",
      platform: null,
    },
  ],
  alerts: ["Test alert"],
};

class FakeRealtime implements RealtimeTripProvider {
  constructor(
    private readonly result: RealtimeTripLookup = {
      trains: [realtimeTrain],
      fetchedAt: "2026-07-23T15:00:00.000Z",
      cacheStatus: "miss",
      sourceUrl: "https://api.example.test/v3/trains/43",
    },
    private readonly failure: Error | null = null,
  ) {}

  async lookup(): Promise<RealtimeTripLookup> {
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.result;
  }
}

function service(
  freshness = new FakeFreshness(),
  realtime?: RealtimeTripProvider,
): TransitToolService {
  return new TransitToolService(
    registry,
    new FakeStore(),
    freshness,
    {
      now: () => new Date("2026-07-23T15:00:00.000Z"),
    },
    realtime,
  );
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
    const server = createTransitMcpServer(
      service(new FakeFreshness(), new FakeRealtime()),
    );
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

      const tripTool = tools.tools.find(
        (candidate) => candidate.name === "trip_status",
      );
      expect(
        tripTool?.inputSchema.properties?.trip_or_train_number,
      ).toMatchObject({
        anyOf: [{ type: "string" }, { type: "integer" }],
      });
      await expect(
        client.callTool({
          name: "trip_status",
          arguments: {
            feed: "amtrak",
            trip_or_train_number: 43,
            service_date: "2026-07-23",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          status: "active",
          count: 1,
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

  it("returns attributed realtime Amtrak trip status and platform data", async () => {
    const freshness = new FakeFreshness();
    await expect(
      service(freshness, new FakeRealtime()).tripStatus({
        feed: "amtrak",
        trip_or_train_number: 43,
        service_date: "2026-07-23",
      }),
    ).resolves.toMatchObject({
      status: "active",
      feed_id: "amtrak",
      realtime_source_id: "amtrak-amtraker",
      train_or_trip: "43",
      count: 1,
      matches: [
        {
          train_id: "43-23",
          train_number: "43",
          delay_minutes: 11,
          position: {
            heading: "SW",
            speed_mph: 62.3,
          },
          station_times: [
            {
              stop_id: "NYP",
              platform: "Track 7",
              departure_delay_minutes: 0,
            },
            {
              stop_id: "HGD",
              platform: null,
              departure_delay_minutes: 11,
            },
          ],
        },
      ],
      source: {
        name: "Amtraker",
        official: false,
      },
      cache_status: "miss",
      stale: false,
      data_as_of: "2026-07-23T14:59:47.000Z",
    });
    expect(freshness.values.get("amtrak-amtraker")?.last_queried).toBe(
      "2026-07-23T15:00:00.000Z",
    );
  });

  it("reports not-found, unsupported, and upstream-unavailable status honestly", async () => {
    const noMatches = new FakeRealtime({
      trains: [],
      fetchedAt: "2026-07-23T15:00:00.000Z",
      cacheStatus: "hit",
      sourceUrl: "https://api.example.test/v3/trains/643",
    });

    await expect(
      service(new FakeFreshness(), noMatches).tripStatus({
        feed: "amtrak",
        trip_or_train_number: "643",
      }),
    ).resolves.toMatchObject({
      status: "not_found",
      count: 0,
      data_as_of: "2026-07-23T15:00:00.000Z",
    });
    await expect(
      service(new FakeFreshness(), noMatches).tripStatus({
        feed: "bay-area",
        trip_or_train_number: "1",
      }),
    ).resolves.toMatchObject({
      status: "not_available",
      tool: "trip_status",
    });
    await expect(
      service(
        new FakeFreshness(),
        new FakeRealtime(undefined, new Error("upstream")),
      ).tripStatus({
        feed: "amtrak",
        trip_or_train_number: "43",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      source: { official: false },
    });
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
