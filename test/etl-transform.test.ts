import { describe, expect, it } from "vitest";
import { filterGtfs, readGtfsDirectory } from "../etl/gtfs.ts";
import { generateSwapSql } from "../etl/sql.ts";
import type { FeedDefinition } from "../etl/types.ts";

const fixtureFeed: FeedDefinition = {
  id: "synthetic",
  agency_name: "Synthetic Transit",
  region: "Test",
  modes: ["bus"],
  priority: 5,
  status: "operational",
  adapter: "gtfs-static",
  source_page: "https://example.com/source",
  download_url: "https://example.com/gtfs.zip",
  filter: {
    bbox: {
      west: -75.1,
      south: 39.9,
      east: -74.9,
      north: 40.1,
    },
    service_window_days: 7,
  },
  license: {
    status: "verified",
    redistributable: true,
  },
};

describe("static GTFS transform", () => {
  it("filters by service window and bounding box without network access", async () => {
    const source = await readGtfsDirectory("fixtures/gtfs/minimal");
    const filtered = filterGtfs(
      source,
      fixtureFeed,
      new Date("2026-07-23T12:00:00Z"),
    );

    expect(filtered.trips.map((row) => row.trip_id)).toEqual(["T1"]);
    expect(filtered.routes.map((row) => row.route_id)).toEqual(["R1"]);
    expect(filtered.stops.map((row) => row.stop_id)).toEqual([
      "HUB",
      "NORTH",
      "SOUTH",
    ]);
    expect(filtered.stop_times).toHaveLength(3);
  });

  it("emits staged tables and a transactionally swapped live set", async () => {
    const source = await readGtfsDirectory("fixtures/gtfs/minimal");
    const filtered = filterGtfs(
      source,
      fixtureFeed,
      new Date("2026-07-23T12:00:00Z"),
    );
    const output = generateSwapSql(
      fixtureFeed,
      filtered,
      {
        versionId: "test-version",
        fetchedAt: "2026-07-23T12:00:00Z",
        sha256: "abc123",
        sourceUrl: fixtureFeed.download_url!,
      },
      "2026-07-23T12:01:00Z",
    );

    expect(output).toContain("CREATE TABLE staging_stops");
    expect(output).toContain("BEGIN IMMEDIATE;");
    expect(output).toContain("ALTER TABLE staging_stops RENAME TO stops;");
    expect(output).toContain("CREATE VIRTUAL TABLE stop_search USING fts5");
    expect(output).toContain("INSERT INTO staging_feed_ingests");
    expect(output).toContain("COMMIT;");
    expect(output).not.toContain("Expired Service");
    expect(output).not.toContain("Outside Filter");
  });
});
