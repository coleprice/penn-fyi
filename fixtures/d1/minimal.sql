-- Apply migrations/0001_gtfs.sql first. This deterministic seed mirrors the
-- filtered result of fixtures/gtfs/minimal for 2026-07-23.
INSERT INTO stops (
  feed_id, stop_id, stop_name, stop_lat, stop_lon, parent_station,
  platform_code, location_type, wheelchair_boarding, timezone
) VALUES
  ('synthetic', 'HUB', 'Synthetic Central', 40.0, -75.0, NULL, NULL, 1, 1, 'America/New_York'),
  ('synthetic', 'NORTH', 'North Platform', 40.01, -75.0, 'HUB', '1', 0, 1, 'America/New_York'),
  ('synthetic', 'SOUTH', 'South Platform', 39.99, -75.0, 'HUB', '2', 0, 1, 'America/New_York');

INSERT INTO routes (
  feed_id, route_id, agency_id, route_short_name, route_long_name,
  route_type, route_color, route_text_color
) VALUES
  ('synthetic', 'R1', 'SYN', '1', 'Synthetic Local', 3, '336699', 'FFFFFF');

INSERT INTO trips (
  feed_id, trip_id, route_id, service_id, trip_headsign, direction_id,
  wheelchair_accessible, bikes_allowed
) VALUES
  ('synthetic', 'T1', 'R1', 'DAILY', 'Northbound', 0, 1, 1);

INSERT INTO stop_times (
  feed_id, trip_id, stop_sequence, stop_id, arrival_time, departure_time,
  pickup_type, drop_off_type
) VALUES
  ('synthetic', 'T1', 1, 'SOUTH', '08:00:00', '08:00:00', 0, 0),
  ('synthetic', 'T1', 2, 'HUB', '08:10:00', '08:11:00', 0, 0),
  ('synthetic', 'T1', 3, 'NORTH', '08:20:00', '08:20:00', 0, 0);

INSERT INTO calendar (
  feed_id, service_id, monday, tuesday, wednesday, thursday, friday,
  saturday, sunday, start_date, end_date
) VALUES
  ('synthetic', 'DAILY', 1, 1, 1, 1, 1, 1, 1, '20260101', '20271231');

INSERT INTO calendar_dates (feed_id, service_id, date, exception_type)
VALUES ('synthetic', 'DAILY', '20260724', 2);

INSERT INTO feed_versions (
  feed_id, version_id, fetched_at, published_at, etag, last_modified,
  sha256, source_url, ingested_at
) VALUES (
  'synthetic', 'fixture-v1', '2026-07-23T12:00:00Z', NULL, '"fixture-v1"',
  NULL, 'fixture-sha256', 'https://example.com/gtfs.zip',
  '2026-07-23T12:01:00Z'
);

INSERT INTO feed_ingests (
  feed_id, last_ingested, status, error, etag, last_modified, sha256,
  source_url
) VALUES (
  'synthetic', '2026-07-23T12:01:00Z', 'ok', NULL, '"fixture-v1"', NULL,
  'fixture-sha256', 'https://example.com/gtfs.zip'
);

INSERT INTO stop_search (feed_id, stop_id, stop_name)
SELECT feed_id, stop_id, stop_name FROM stops WHERE feed_id = 'synthetic';
