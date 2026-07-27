import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateRegistry } from "../etl/registry.ts";

describe("feed registry", () => {
  it("validates the committed nationwide registry", async () => {
    const registry = validateRegistry(
      JSON.parse(await readFile("feeds.json", "utf8")) as unknown,
    );

    expect(registry.feeds[0]?.id).toBe("amtrak");
    expect(registry.feeds[0]?.priority).toBe(1);
    expect(registry.feeds[0]?.filter?.agency_ids).toEqual(["51"]);
    expect(registry.feeds.some((feed) => feed.id === "pocono-pony")).toBe(true);
    expect(
      registry.feeds.find((feed) => feed.id === "mta-subway")?.realtime?.auth,
    ).toBe("none");
    expect(
      registry.feeds.some((feed) => feed.id === "bay-area-511-regional"),
    ).toBe(true);
    expect(
      registry.feeds.find((feed) => feed.id === "bay-area-511-bart")?.status,
    ).toBe("operational");
  });

  it("rejects duplicate IDs and unverified redistribution", () => {
    const feed = {
      id: "example",
      agency_name: "Example",
      region: "Somewhere",
      modes: ["bus"],
      priority: 3,
      status: "planned",
      adapter: "gtfs-static",
      source_page: "https://example.com/developers",
      license: {
        status: "review_required",
        redistributable: true,
      },
    };
    expect(() =>
      validateRegistry({
        schema_version: 1,
        updated_at: "2026-07-23T00:00:00Z",
        feeds: [feed, feed],
      }),
    ).toThrow(/redistributable before license verification/);
  });
});
