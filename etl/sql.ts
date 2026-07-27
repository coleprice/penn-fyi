import type {
  CsvRow,
  FeedDefinition,
  FeedVersion,
  GtfsTables,
} from "./types.ts";

function sql(value: string | undefined): string {
  return value === undefined || value === ""
    ? "NULL"
    : `'${value.replaceAll("'", "''")}'`;
}

function number(value: string | undefined): string {
  if (value === undefined || value === "") return "NULL";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "NULL";
}

function insert(
  table: string,
  columns: string[],
  rows: string[][],
  conflictClause = "",
): string[] {
  if (rows.length === 0) return [];
  const statements: string[] = [];
  const batchSize = 250;
  for (let start = 0; start < rows.length; start += batchSize) {
    const values = rows
      .slice(start, start + batchSize)
      .map((row) => `(${row.join(",")})`)
      .join(",\n");
    statements.push(
      `INSERT${conflictClause} INTO staging_${table} (${columns.join(",")}) VALUES\n${values};`,
    );
  }
  return statements;
}

const TABLE_DDL: Record<string, string> = {
  stops: `(feed_id TEXT NOT NULL, stop_id TEXT NOT NULL, stop_name TEXT NOT NULL, stop_lat REAL, stop_lon REAL, parent_station TEXT, platform_code TEXT, location_type INTEGER, wheelchair_boarding INTEGER, timezone TEXT, PRIMARY KEY (feed_id, stop_id))`,
  routes: `(feed_id TEXT NOT NULL, route_id TEXT NOT NULL, agency_id TEXT, route_short_name TEXT, route_long_name TEXT, route_type INTEGER NOT NULL, route_color TEXT, route_text_color TEXT, PRIMARY KEY (feed_id, route_id))`,
  trips: `(feed_id TEXT NOT NULL, trip_id TEXT NOT NULL, route_id TEXT NOT NULL, service_id TEXT NOT NULL, trip_headsign TEXT, direction_id INTEGER, wheelchair_accessible INTEGER, bikes_allowed INTEGER, PRIMARY KEY (feed_id, trip_id))`,
  stop_times: `(feed_id TEXT NOT NULL, trip_id TEXT NOT NULL, stop_sequence INTEGER NOT NULL, stop_id TEXT NOT NULL, arrival_time TEXT, departure_time TEXT, pickup_type INTEGER, drop_off_type INTEGER, PRIMARY KEY (feed_id, trip_id, stop_sequence))`,
  calendar: `(feed_id TEXT NOT NULL, service_id TEXT NOT NULL, monday INTEGER NOT NULL, tuesday INTEGER NOT NULL, wednesday INTEGER NOT NULL, thursday INTEGER NOT NULL, friday INTEGER NOT NULL, saturday INTEGER NOT NULL, sunday INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, PRIMARY KEY (feed_id, service_id))`,
  calendar_dates: `(feed_id TEXT NOT NULL, service_id TEXT NOT NULL, date TEXT NOT NULL, exception_type INTEGER NOT NULL, PRIMARY KEY (feed_id, service_id, date))`,
  feed_versions: `(feed_id TEXT NOT NULL, version_id TEXT NOT NULL, fetched_at TEXT NOT NULL, published_at TEXT, etag TEXT, last_modified TEXT, sha256 TEXT NOT NULL, source_url TEXT NOT NULL, ingested_at TEXT NOT NULL, PRIMARY KEY (feed_id, version_id))`,
  feed_ingests: `(feed_id TEXT NOT NULL PRIMARY KEY, last_ingested TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('ok', 'error')), error TEXT, etag TEXT, last_modified TEXT, sha256 TEXT, source_url TEXT NOT NULL)`,
};

const TABLES = Object.keys(TABLE_DDL);

export function generateSwapSql(
  feed: FeedDefinition,
  tables: GtfsTables,
  version: FeedVersion,
  ingestedAt = new Date().toISOString(),
): string {
  const feedId = sql(feed.id);
  const timezone =
    tables.agency.find((row) => row.agency_timezone)?.agency_timezone ??
    "America/New_York";
  const statements = [
    "PRAGMA foreign_keys = OFF;",
    ...TABLES.flatMap((table) => [
      `DROP TABLE IF EXISTS staging_${table};`,
      `CREATE TABLE staging_${table} ${TABLE_DDL[table]};`,
      `INSERT INTO staging_${table} SELECT * FROM ${table}${table === "feed_versions" ? "" : ` WHERE feed_id <> ${feedId}`};`,
    ]),
    ...insert(
      "stops",
      [
        "feed_id",
        "stop_id",
        "stop_name",
        "stop_lat",
        "stop_lon",
        "parent_station",
        "platform_code",
        "location_type",
        "wheelchair_boarding",
        "timezone",
      ],
      tables.stops.map((row) => [
        feedId,
        sql(row.stop_id),
        sql(row.stop_name),
        number(row.stop_lat),
        number(row.stop_lon),
        sql(row.parent_station),
        sql(row.platform_code),
        number(row.location_type),
        number(row.wheelchair_boarding),
        sql(row.stop_timezone || timezone),
      ]),
    ),
    ...insert(
      "routes",
      [
        "feed_id",
        "route_id",
        "agency_id",
        "route_short_name",
        "route_long_name",
        "route_type",
        "route_color",
        "route_text_color",
      ],
      tables.routes.map((row) => [
        feedId,
        sql(row.route_id),
        sql(row.agency_id),
        sql(row.route_short_name),
        sql(row.route_long_name),
        number(row.route_type),
        sql(row.route_color),
        sql(row.route_text_color),
      ]),
    ),
    ...insert(
      "trips",
      [
        "feed_id",
        "trip_id",
        "route_id",
        "service_id",
        "trip_headsign",
        "direction_id",
        "wheelchair_accessible",
        "bikes_allowed",
      ],
      tables.trips.map((row) => [
        feedId,
        sql(row.trip_id),
        sql(row.route_id),
        sql(row.service_id),
        sql(row.trip_headsign),
        number(row.direction_id),
        number(row.wheelchair_accessible),
        number(row.bikes_allowed),
      ]),
    ),
    ...insert(
      "stop_times",
      [
        "feed_id",
        "trip_id",
        "stop_sequence",
        "stop_id",
        "arrival_time",
        "departure_time",
        "pickup_type",
        "drop_off_type",
      ],
      tables.stop_times.map((row) => [
        feedId,
        sql(row.trip_id),
        number(row.stop_sequence),
        sql(row.stop_id),
        sql(row.arrival_time),
        sql(row.departure_time),
        number(row.pickup_type),
        number(row.drop_off_type),
      ]),
    ),
    ...insert(
      "calendar",
      [
        "feed_id",
        "service_id",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "start_date",
        "end_date",
      ],
      tables.calendar.map((row) => [
        feedId,
        sql(row.service_id),
        number(row.monday),
        number(row.tuesday),
        number(row.wednesday),
        number(row.thursday),
        number(row.friday),
        number(row.saturday),
        number(row.sunday),
        sql(row.start_date),
        sql(row.end_date),
      ]),
    ),
    ...insert(
      "calendar_dates",
      ["feed_id", "service_id", "date", "exception_type"],
      tables.calendar_dates.map((row) => [
        feedId,
        sql(row.service_id),
        sql(row.date),
        number(row.exception_type),
      ]),
    ),
    ...insert(
      "feed_versions",
      [
        "feed_id",
        "version_id",
        "fetched_at",
        "published_at",
        "etag",
        "last_modified",
        "sha256",
        "source_url",
        "ingested_at",
      ],
      [
        [
          feedId,
          sql(version.versionId),
          sql(version.fetchedAt),
          sql(version.publishedAt),
          sql(version.etag),
          sql(version.lastModified),
          sql(version.sha256),
          sql(version.sourceUrl),
          sql(ingestedAt),
        ],
      ],
      " OR IGNORE",
    ),
    ...insert(
      "feed_ingests",
      [
        "feed_id",
        "last_ingested",
        "status",
        "error",
        "etag",
        "last_modified",
        "sha256",
        "source_url",
      ],
      [
        [
          feedId,
          sql(ingestedAt),
          sql("ok"),
          "NULL",
          sql(version.etag),
          sql(version.lastModified),
          sql(version.sha256),
          sql(version.sourceUrl),
        ],
      ],
    ),
    ...TABLES.map((table) => `ALTER TABLE ${table} RENAME TO old_${table};`),
    ...TABLES.map(
      (table) => `ALTER TABLE staging_${table} RENAME TO ${table};`,
    ),
    ...TABLES.map((table) => `DROP TABLE old_${table};`),
    "DROP TABLE IF EXISTS stop_search;",
    "CREATE VIRTUAL TABLE stop_search USING fts5(feed_id UNINDEXED, stop_id UNINDEXED, stop_name, tokenize='unicode61 remove_diacritics 2');",
    "INSERT INTO stop_search(feed_id, stop_id, stop_name) SELECT feed_id, stop_id, stop_name FROM stops;",
    "CREATE INDEX idx_stops_coordinates ON stops(stop_lat, stop_lon);",
    "CREATE INDEX idx_routes_name ON routes(feed_id, route_short_name, route_long_name);",
    "CREATE INDEX idx_trips_route_service ON trips(feed_id, route_id, service_id);",
    "CREATE INDEX idx_stop_times_stop_departure ON stop_times(feed_id, stop_id, departure_time);",
    "CREATE INDEX idx_calendar_dates_date ON calendar_dates(feed_id, date);",
    "CREATE INDEX idx_feed_versions_ingested ON feed_versions(feed_id, ingested_at DESC);",
    "PRAGMA foreign_keys = ON;",
  ];
  return `${statements.join("\n\n")}\n`;
}

export function summarizeTables(tables: GtfsTables): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.length]),
  );
}
