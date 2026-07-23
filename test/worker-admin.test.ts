import { describe, expect, it } from "vitest";

import {
  bearerToken,
  constantTimeTokenEqual,
  ingestNeeded,
} from "../src/admin";
import type { FreshnessStore } from "../src/freshness";
import type { FeedFreshness, FeedRegistry } from "../src/types/gtfs";

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
      id: "unused",
      agency_name: "Unused Transit",
      region: "United States",
      adapter: "gtfs-static",
      download_url: "https://example.test/unused.zip",
      priority: 5,
      status: "operational",
      source_page: "https://example.test/unused",
      modes: ["bus"],
      license: { status: "review_required", redistributable: false },
    },
  ],
};

class FakeFreshness {
  constructor(private readonly values: ReadonlyMap<string, FeedFreshness>) {}

  async getMany(): Promise<ReadonlyMap<string, FeedFreshness>> {
    return this.values;
  }
}

describe("admin ingest-needed", () => {
  it("compares fixed-size token digests", async () => {
    await expect(
      constantTimeTokenEqual("correct-token", "correct-token"),
    ).resolves.toBe(true);
    await expect(
      constantTimeTokenEqual("wrong", "correct-token"),
    ).resolves.toBe(false);
    await expect(constantTimeTokenEqual("", undefined)).resolves.toBe(false);
  });

  it("extracts only a bearer token", () => {
    expect(
      bearerToken(
        new Request("https://mcp.penn.fyi/admin/ingest-needed", {
          headers: { authorization: "Bearer secret-token" },
        }),
      ),
    ).toBe("secret-token");
    expect(
      bearerToken(
        new Request("https://mcp.penn.fyi/admin/ingest-needed", {
          headers: { authorization: "Basic nope" },
        }),
      ),
    ).toBe("");
  });

  it("returns only stale feeds queried within the configured window", async () => {
    const freshness = new Map<string, FeedFreshness>([
      [
        "amtrak",
        {
          feed_id: "amtrak",
          status: "stale",
          checked_at: "2026-07-23T12:00:00.000Z",
          last_ingested: "2026-07-20T12:00:00.000Z",
          last_queried: "2026-07-23T11:00:00.000Z",
        },
      ],
      [
        "unused",
        {
          feed_id: "unused",
          status: "stale",
          checked_at: "2026-07-01T12:00:00.000Z",
          last_ingested: "2026-06-01T12:00:00.000Z",
          last_queried: "2026-06-01T12:00:00.000Z",
        },
      ],
    ]);

    await expect(
      ingestNeeded(
        registry,
        new FakeFreshness(freshness),
        new Date("2026-07-23T15:00:00.000Z"),
        { staleAfterHours: 48, recentQueryWindowDays: 14 },
      ),
    ).resolves.toEqual({
      needed: true,
      feeds: [
        {
          feed_id: "amtrak",
          reason: "stale",
          last_queried: "2026-07-23T11:00:00.000Z",
          last_ingested: "2026-07-20T12:00:00.000Z",
          checked_at: "2026-07-23T12:00:00.000Z",
          status: "stale",
        },
      ],
      data_as_of: "2026-07-23T15:00:00.000Z",
    });
  });
});
