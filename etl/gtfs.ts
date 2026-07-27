import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import yauzl from "yauzl-promise";
import type {
  CsvRow,
  FeedDefinition,
  FeedFilter,
  GtfsTables,
} from "./types.ts";

const FILES = [
  "agency",
  "stops",
  "routes",
  "trips",
  "stop_times",
  "calendar",
  "calendar_dates",
  "feed_info",
] as const;

function parseCsv(input: Buffer | string): CsvRow[] {
  return parse(input, {
    bom: true,
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];
}

function emptyTables(): GtfsTables {
  return {
    agency: [],
    stops: [],
    routes: [],
    trips: [],
    stop_times: [],
    calendar: [],
    calendar_dates: [],
    feed_info: [],
  };
}

export async function readGtfsDirectory(
  directory: string,
): Promise<GtfsTables> {
  const tables = emptyTables();
  await Promise.all(
    FILES.map(async (name) => {
      try {
        tables[name] = parseCsv(await readFile(join(directory, `${name}.txt`)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }),
  );
  validateRequiredTables(tables);
  return tables;
}

export async function readGtfsZip(path: string): Promise<GtfsTables> {
  const tables = emptyTables();
  const wanted = new Map(FILES.map((name) => [`${name}.txt`, name]));
  const zip = await yauzl.open(path);
  try {
    for await (const entry of zip) {
      const fileName = entry.filename.split("/").at(-1)?.toLowerCase();
      if (!fileName) continue;
      const table = wanted.get(fileName);
      if (!table) continue;
      const stream = await entry.openReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      tables[table] = parseCsv(Buffer.concat(chunks));
    }
  } finally {
    await zip.close();
  }
  validateRequiredTables(tables);
  return tables;
}

function validateRequiredTables(tables: GtfsTables): void {
  for (const name of ["stops", "routes", "trips", "stop_times"] as const) {
    if (tables[name].length === 0) {
      throw new Error(`GTFS archive has no ${name}.txt records`);
    }
  }
  if (tables.calendar.length === 0 && tables.calendar_dates.length === 0) {
    throw new Error("GTFS archive needs calendar.txt or calendar_dates.txt");
  }
}

function gtfsDate(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("");
}

function activeServices(
  tables: GtfsTables,
  days: number,
  now: Date,
): Set<string> {
  const active = new Set<string>();
  const exceptions = new Map<string, Map<string, string>>();
  for (const row of tables.calendar_dates) {
    const date = row.date;
    const serviceId = row.service_id;
    const exceptionType = row.exception_type;
    if (!date || !serviceId || !exceptionType) continue;
    const byDate = exceptions.get(date) ?? new Map<string, string>();
    byDate.set(serviceId, exceptionType);
    exceptions.set(date, byDate);
  }
  const weekdayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  for (let offset = 0; offset <= days; offset += 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    const dateString = gtfsDate(date);
    const weekday = weekdayNames[date.getUTCDay()];
    if (!weekday) throw new Error("invalid weekday");
    for (const row of tables.calendar) {
      const startDate = row.start_date;
      const endDate = row.end_date;
      const serviceId = row.service_id;
      if (
        startDate &&
        endDate &&
        serviceId &&
        startDate <= dateString &&
        endDate >= dateString &&
        row[weekday] === "1"
      ) {
        active.add(serviceId);
      }
    }
    for (const [serviceId, exceptionType] of exceptions.get(dateString) ?? []) {
      if (exceptionType === "1") active.add(serviceId);
      if (exceptionType === "2") active.delete(serviceId);
    }
  }
  return active;
}

function inBbox(row: CsvRow, bbox: NonNullable<FeedFilter["bbox"]>): boolean {
  const latitude = Number(row.stop_lat);
  const longitude = Number(row.stop_lon);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= bbox.south &&
    latitude <= bbox.north &&
    longitude >= bbox.west &&
    longitude <= bbox.east
  );
}

export function filterGtfs(
  tables: GtfsTables,
  feed: FeedDefinition,
  now = new Date(),
): GtfsTables {
  const filter = feed.filter;
  let agency = tables.agency;
  let routes = tables.routes;
  if (filter?.agency_ids?.length) {
    const wanted = new Set(filter.agency_ids);
    agency = agency.filter(
      (row) => row.agency_id !== undefined && wanted.has(row.agency_id),
    );
    routes = routes.filter(
      (route) => route.agency_id !== undefined && wanted.has(route.agency_id),
    );
  }
  if (filter?.route_ids?.length) {
    const wanted = new Set(filter.route_ids);
    routes = routes.filter(
      (route) => route.route_id !== undefined && wanted.has(route.route_id),
    );
  }
  if (filter?.route_short_names?.length) {
    const wanted = new Set(filter.route_short_names);
    routes = routes.filter(
      (route) =>
        route.route_short_name !== undefined &&
        wanted.has(route.route_short_name),
    );
  }
  const routeIds = new Set(routes.map((route) => route.route_id));
  const services = activeServices(
    tables,
    filter?.service_window_days ?? 60,
    now,
  );
  let trips = tables.trips.filter(
    (trip) =>
      trip.route_id !== undefined &&
      routeIds.has(trip.route_id) &&
      (services.size === 0 ||
        (trip.service_id !== undefined && services.has(trip.service_id))),
  );
  let tripIds = new Set(trips.map((trip) => trip.trip_id));
  let stopTimes = tables.stop_times.filter((row) => tripIds.has(row.trip_id));
  let stopIds = new Set(stopTimes.map((row) => row.stop_id));
  let stops = tables.stops.filter((stop) => stopIds.has(stop.stop_id));

  if (filter?.bbox) {
    const spatialStops = new Set(
      stops
        .filter((stop) => inBbox(stop, filter.bbox!))
        .map((stop) => stop.stop_id),
    );
    stopTimes = stopTimes.filter((row) => spatialStops.has(row.stop_id));
    tripIds = new Set(stopTimes.map((row) => row.trip_id));
    trips = trips.filter((trip) => tripIds.has(trip.trip_id));
    const retainedRoutes = new Set(trips.map((trip) => trip.route_id));
    routes = routes.filter((route) => retainedRoutes.has(route.route_id));
    stopIds = new Set(stopTimes.map((row) => row.stop_id));
    stops = stops.filter((stop) => stopIds.has(stop.stop_id));
  }

  const serviceIds = new Set(trips.map((trip) => trip.service_id));
  return {
    agency,
    stops,
    routes,
    trips,
    stop_times: stopTimes,
    calendar: tables.calendar.filter((row) => serviceIds.has(row.service_id)),
    calendar_dates: tables.calendar_dates.filter((row) =>
      serviceIds.has(row.service_id),
    ),
    feed_info: tables.feed_info,
  };
}
