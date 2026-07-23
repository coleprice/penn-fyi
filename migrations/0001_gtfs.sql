PRAGMA foreign_keys = ON;

CREATE TABLE stops (
  feed_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  stop_name TEXT NOT NULL,
  stop_lat REAL,
  stop_lon REAL,
  parent_station TEXT,
  platform_code TEXT,
  location_type INTEGER,
  wheelchair_boarding INTEGER,
  timezone TEXT,
  PRIMARY KEY (feed_id, stop_id)
);

CREATE TABLE routes (
  feed_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  agency_id TEXT,
  route_short_name TEXT,
  route_long_name TEXT,
  route_type INTEGER NOT NULL,
  route_color TEXT,
  route_text_color TEXT,
  PRIMARY KEY (feed_id, route_id)
);

CREATE TABLE trips (
  feed_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  trip_headsign TEXT,
  direction_id INTEGER,
  wheelchair_accessible INTEGER,
  bikes_allowed INTEGER,
  PRIMARY KEY (feed_id, trip_id)
);

CREATE TABLE stop_times (
  feed_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  stop_sequence INTEGER NOT NULL,
  stop_id TEXT NOT NULL,
  arrival_time TEXT,
  departure_time TEXT,
  pickup_type INTEGER,
  drop_off_type INTEGER,
  PRIMARY KEY (feed_id, trip_id, stop_sequence)
);

CREATE TABLE calendar (
  feed_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  monday INTEGER NOT NULL,
  tuesday INTEGER NOT NULL,
  wednesday INTEGER NOT NULL,
  thursday INTEGER NOT NULL,
  friday INTEGER NOT NULL,
  saturday INTEGER NOT NULL,
  sunday INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  PRIMARY KEY (feed_id, service_id)
);

CREATE TABLE calendar_dates (
  feed_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  date TEXT NOT NULL,
  exception_type INTEGER NOT NULL,
  PRIMARY KEY (feed_id, service_id, date)
);

CREATE TABLE feed_versions (
  feed_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  published_at TEXT,
  etag TEXT,
  last_modified TEXT,
  sha256 TEXT NOT NULL,
  source_url TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (feed_id, version_id)
);

CREATE TABLE feed_ingests (
  feed_id TEXT NOT NULL PRIMARY KEY,
  last_ingested TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error TEXT,
  etag TEXT,
  last_modified TEXT,
  sha256 TEXT,
  source_url TEXT NOT NULL
);

CREATE INDEX idx_stops_coordinates
  ON stops(stop_lat, stop_lon);
CREATE INDEX idx_routes_name
  ON routes(feed_id, route_short_name, route_long_name);
CREATE INDEX idx_trips_route_service
  ON trips(feed_id, route_id, service_id);
CREATE INDEX idx_stop_times_stop_departure
  ON stop_times(feed_id, stop_id, departure_time);
CREATE INDEX idx_calendar_dates_date
  ON calendar_dates(feed_id, date);
CREATE INDEX idx_feed_versions_ingested
  ON feed_versions(feed_id, ingested_at DESC);

CREATE VIRTUAL TABLE stop_search USING fts5(
  feed_id UNINDEXED,
  stop_id UNINDEXED,
  stop_name,
  tokenize='unicode61 remove_diacritics 2'
);
