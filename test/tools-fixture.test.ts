import { readFile } from "node:fs/promises";

import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";

import type {
  FindStopCandidatesInput,
  TransitStore,
} from "../src/data/transit-store";
import type { FreshnessStore } from "../src/freshness";
import { parseFeedRegistry } from "../src/registry/parse";
import { TransitToolService } from "../src/tools/service";
import type { FeedFreshness, FeedVersion, StopRecord } from "../src/types/gtfs";

interface FixtureStopRow {
  readonly stop_id: string;
  readonly stop_name: string;
  readonly stop_lat: string;
  readonly stop_lon: string;
  readonly parent_station?: string;
  readonly platform_code?: string;
  readonly location_type?: string;
  readonly wheelchair_boarding?: string;
  readonly stop_timezone?: string;
}

function nullableString(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function nullableNumber(value: string | undefined): number | null {
  return value === undefined || value === "" ? null : Number(value);
}

class FixtureGtfsStore implements TransitStore {
  constructor(private readonly stops: readonly StopRecord[]) {}

  async findStopCandidates(
    input: FindStopCandidatesInput,
  ): Promise<readonly StopRecord[]> {
    return this.stops
      .filter(
        (stop) =>
          stop.name
            .toLocaleLowerCase("en-US")
            .includes(input.normalizedQuery) ||
          stop.stopId
            .toLocaleLowerCase("en-US")
            .includes(input.normalizedQuery),
      )
      .slice(0, input.candidateLimit);
  }

  async getFeedVersions(
    feedIds: readonly string[],
  ): Promise<readonly FeedVersion[]> {
    return feedIds.includes("synthetic")
      ? [
          {
            feedId: "synthetic",
            ingestedAt: "2026-07-23T12:01:00.000Z",
          },
        ]
      : [];
  }
}

class FixtureFreshness implements FreshnessStore {
  readonly queries: string[] = [];

  async getMany(): Promise<ReadonlyMap<string, FeedFreshness>> {
    return new Map();
  }

  async recordQueries(feedIds: readonly string[]): Promise<void> {
    this.queries.push(...feedIds);
  }
}

async function loadFixtureRegistry() {
  const source: unknown = JSON.parse(
    await readFile("fixtures/feeds.test.json", "utf8"),
  );
  return parseFeedRegistry(source);
}

async function loadFixtureStops(): Promise<readonly StopRecord[]> {
  const csv = await readFile("fixtures/gtfs/minimal/stops.txt", "utf8");
  const rows = parse<FixtureStopRow>(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  });
  return rows.map((row) => ({
    feedId: "synthetic",
    stopId: row.stop_id,
    name: row.stop_name,
    latitude: nullableNumber(row.stop_lat),
    longitude: nullableNumber(row.stop_lon),
    timezone: nullableString(row.stop_timezone),
    locationType: nullableNumber(row.location_type),
    parentStation: nullableString(row.parent_station),
    platformCode: nullableString(row.platform_code),
    wheelchairBoarding: nullableNumber(row.wheelchair_boarding),
  }));
}

describe("Worker tools with committed fixtures", () => {
  it("lists the committed fixture registry with its dataset version", async () => {
    const service = new TransitToolService(
      await loadFixtureRegistry(),
      new FixtureGtfsStore(await loadFixtureStops()),
      new FixtureFreshness(),
      { now: () => new Date("2026-07-23T15:00:00.000Z") },
    );

    await expect(service.listFeeds()).resolves.toMatchObject({
      count: 1,
      data_as_of: "2026-07-23T15:00:00.000Z",
      feeds: [
        {
          id: "synthetic",
          agency: "Synthetic Transit",
          status: "operational",
          freshness: {
            status: "available",
            last_ingested: "2026-07-23T12:01:00.000Z",
          },
        },
      ],
    });
  });

  it("loads and searches the committed fixture without network access", async () => {
    const freshness = new FixtureFreshness();
    const service = new TransitToolService(
      await loadFixtureRegistry(),
      new FixtureGtfsStore(await loadFixtureStops()),
      freshness,
      { now: () => new Date("2026-07-23T15:00:00.000Z") },
    );

    await expect(
      service.findStops({ query: "Central" }),
    ).resolves.toMatchObject({
      count: 1,
      data_as_of: "2026-07-23T12:01:00.000Z",
      stops: [
        {
          feed_id: "synthetic",
          stop_id: "HUB",
          name: "Synthetic Central",
          timezone: "America/New_York",
        },
      ],
    });
    expect(freshness.queries).toEqual(["synthetic"]);
  });
});
