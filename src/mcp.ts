import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { TransitToolService } from "./tools/service";

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function stopReference(description: string) {
  return z
    .union([
      z.string().min(1),
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ])
    .describe(description);
}

function tripIdentifier(description: string) {
  return z
    .union([
      z.string().min(1).max(32),
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ])
    .describe(description);
}

export function createTransitMcpServer(service: TransitToolService): McpServer {
  const server = new McpServer({
    name: "penn-fyi",
    version: "0.1.0",
  });

  server.registerTool(
    "list_feeds",
    {
      description:
        "List nationwide transit feeds known to penn-fyi and their current schedule freshness. Times are timezone-aware ISO-8601 values with offsets. Every result includes data_as_of.",
      inputSchema: {},
    },
    async () => result(await service.listFeeds()),
  );

  server.registerTool(
    "find_stops",
    {
      description:
        "Resolve a human stop or station name to feed-scoped GTFS stop IDs. Optionally rank by a WGS84 latitude/longitude point and filter by radius_km. Distances are kilometers. Dataset time is a timezone-aware ISO-8601 value with offset, or null when no matching feed version has been ingested.",
      inputSchema: {
        query: z
          .string()
          .min(2)
          .describe("Human station/stop name or exact agency stop ID."),
        near: z
          .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            radius_km: z.number().positive().max(500).optional(),
          })
          .optional()
          .describe(
            "Optional WGS84 point used for distance ranking; radius_km filters results.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum number of stops to return, from 1 through 50."),
      },
    },
    async (input) => result(await service.findStops(input)),
  );

  server.registerTool(
    "next_departures",
    {
      description:
        "Return scheduled trips departing an exact GTFS stop ID, optionally requiring a later destination stop on the same trip. Use from_stop for the origin; the deprecated stop alias remains accepted for older clients. Numeric stop IDs and feed-qualified references such as bay-area-511-bart:901401 are accepted. service_date is the origin's local GTFS service date; after_time and before_time are local GTFS HH:MM[:SS] values and may run through 47:59:59 for after-midnight service. Results are timezone-offset ISO-8601 timestamps. Realtime is not yet merged; every result states realtime_included and data_as_of.",
      inputSchema: {
        from_stop: stopReference(
          "Preferred origin. Exact GTFS stop ID returned by find_stops, optionally feed-qualified as feed_id:stop_id. Strings are safest for IDs with leading zeroes.",
        ).optional(),
        stop: stopReference(
          "Deprecated compatibility alias for from_stop. Do not send both fields.",
        ).optional(),
        to_stop: stopReference(
          "Optional exact destination stop ID that must occur later on the same trip; may use feed_id:stop_id.",
        ).optional(),
        service_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe(
            "Origin-local GTFS service date in YYYY-MM-DD form. Defaults to the current local date.",
          ),
        after_time: z
          .string()
          .regex(/^\d{2}:[0-5]\d(?::[0-5]\d)?$/)
          .optional()
          .describe(
            "Earliest origin-local GTFS departure time, HH:MM or HH:MM:SS. Defaults to now for today and 00:00 for an explicit date.",
          ),
        before_time: z
          .string()
          .regex(/^\d{2}:[0-5]\d(?::[0-5]\d)?$/)
          .optional()
          .describe(
            "Latest origin-local GTFS departure time through 47:59:59.",
          ),
        feed: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional feed ID used to disambiguate stop IDs, such as amtrak.",
          ),
        route: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional route ID, train number, route short name, or substring of the route long name.",
          ),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async (input) => result(await service.nextDepartures(input)),
  );

  server.registerTool(
    "trip_status",
    {
      description:
        "Report the current status of an active or predeparture Amtrak train using the unofficial Amtraker source, cached for 20–30 seconds. Returns position and speed when available, current delay, alerts, station-by-station scheduled and reported times, and platform assignments when the source publishes them. Use service_date to disambiguate multiple active instances of a train number. Times are timezone-aware ISO-8601 values with offsets; speed is mph; every result identifies the unofficial source and includes data_as_of.",
      inputSchema: {
        feed: z
          .enum(["amtrak", "amtrak-amtraker"])
          .describe(
            "Use amtrak; amtrak-amtraker is accepted as an explicit source alias.",
          ),
        trip_or_train_number: tripIdentifier(
          "Amtrak train number such as 43, or Amtraker train ID such as 43-27.",
        ),
        service_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Optional train-origin service date in YYYY-MM-DD form."),
      },
    },
    async (input) => result(await service.tripStatus(input)),
  );

  server.registerTool(
    "transfer_window",
    {
      description:
        "Estimate whether one trip will connect to another at a station. Not available in the initial scaffold. Future window values will use minutes and timezone-aware ISO-8601 times with offsets; every result includes data_as_of.",
      inputSchema: {
        from_trip: z.string().min(1),
        to_trip: z.string().min(1),
        station: z.string().min(1),
      },
    },
    async () =>
      result(
        service.stub(
          "transfer_window",
          "Connection risk calculation awaits schedule and realtime trip support.",
        ),
      ),
  );

  server.registerTool(
    "service_alerts",
    {
      description:
        "Return current service alerts for a feed and optional route. Not available in the initial scaffold. Future alert times will be timezone-aware ISO-8601 values with offsets and every result includes data_as_of.",
      inputSchema: {
        feed: z.string().min(1),
        route: z.string().min(1).optional(),
      },
    },
    async () =>
      result(
        service.stub(
          "service_alerts",
          "GTFS-Realtime alert fetching and caching are not implemented yet.",
        ),
      ),
  );

  return server;
}
