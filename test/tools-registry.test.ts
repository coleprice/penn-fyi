import { describe, expect, it } from "vitest";

import { parseFeedRegistry } from "../src/registry/parse";

describe("parseFeedRegistry", () => {
  it("validates a GTFS feed without exposing credentials", () => {
    expect(
      parseFeedRegistry({
        schema_version: 1,
        updated_at: "2026-07-23T00:00:00.000Z",
        feeds: [
          {
            id: "test-bus",
            agency_name: "Test Bus",
            region: "Pennsylvania",
            adapter: "gtfs-static",
            download_url: "https://example.test/gtfs.zip",
            source_page: "https://example.test/test-bus",
            realtime: {
              trip_updates: ["https://example.test/trip-updates.pb"],
              auth: "none",
            },
            priority: 2,
            status: "operational",
            modes: ["bus"],
            license: {
              status: "review_required",
              redistributable: false,
            },
          },
        ],
      }),
    ).toMatchObject({
      feeds: [
        {
          id: "test-bus",
          adapter: "gtfs-static",
          realtime: {
            trip_updates: ["https://example.test/trip-updates.pb"],
            auth: "none",
          },
        },
      ],
    });
  });

  it("rejects duplicate feed IDs", () => {
    const feed = {
      id: "duplicate",
      agency_name: "Test",
      region: "United States",
      adapter: "amtraker",
      priority: 5,
      status: "discovery",
      source_page: "https://example.test/test",
      modes: ["rail"],
      license: { status: "review_required", redistributable: false },
    };
    expect(() =>
      parseFeedRegistry({
        schema_version: 1,
        updated_at: "2026-07-23T00:00:00.000Z",
        feeds: [feed, feed],
      }),
    ).toThrow('Duplicate feed id "duplicate"');
  });
});
