import type {
  FeedVersion,
  ScheduledTripRecord,
  StopRecord,
} from "../types/gtfs";
import type {
  FindScheduledTripsInput,
  FindStopCandidatesInput,
  FindStopsByIdInput,
  TransitStore,
} from "./transit-store";

interface StopRow {
  readonly feed_id: string;
  readonly stop_id: string;
  readonly stop_name: string;
  readonly stop_lat: number | null;
  readonly stop_lon: number | null;
  readonly timezone: string | null;
  readonly location_type: number | null;
  readonly parent_station: string | null;
  readonly platform_code: string | null;
  readonly wheelchair_boarding: number | null;
}

interface FeedVersionRow {
  readonly feed_id: string;
  readonly ingested_at: string;
}

interface ScheduledTripRow {
  readonly feed_id: string;
  readonly trip_id: string;
  readonly trip_short_name: string | null;
  readonly route_id: string;
  readonly route_short_name: string | null;
  readonly route_long_name: string | null;
  readonly route_type: number;
  readonly trip_headsign: string | null;
  readonly direction_id: number | null;
  readonly from_stop_id: string;
  readonly from_stop_name: string;
  readonly from_timezone: string;
  readonly departure_time: string;
  readonly departure_seconds: number;
  readonly to_stop_id: string | null;
  readonly to_stop_name: string | null;
  readonly to_timezone: string | null;
  readonly arrival_time: string | null;
  readonly arrival_seconds: number | null;
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function mapStop(row: StopRow): StopRecord {
  return {
    feedId: row.feed_id,
    stopId: row.stop_id,
    name: row.stop_name,
    latitude: row.stop_lat,
    longitude: row.stop_lon,
    timezone: row.timezone,
    locationType: row.location_type,
    parentStation: row.parent_station,
    platformCode: row.platform_code,
    wheelchairBoarding: row.wheelchair_boarding,
  };
}

function gtfsSeconds(column: string): string {
  return `(CAST(substr(${column}, 1, instr(${column}, ':') - 1) AS INTEGER) * 3600
    + CAST(substr(${column}, instr(${column}, ':') + 1, 2) AS INTEGER) * 60
    + CAST(substr(${column}, -2) AS INTEGER))`;
}

function mapScheduledTrip(row: ScheduledTripRow): ScheduledTripRecord {
  return {
    feedId: row.feed_id,
    tripId: row.trip_id,
    tripShortName: row.trip_short_name,
    routeId: row.route_id,
    routeShortName: row.route_short_name,
    routeLongName: row.route_long_name,
    routeType: row.route_type,
    tripHeadsign: row.trip_headsign,
    directionId: row.direction_id,
    fromStopId: row.from_stop_id,
    fromStopName: row.from_stop_name,
    fromTimezone: row.from_timezone,
    departureTime: row.departure_time,
    departureSeconds: row.departure_seconds,
    toStopId: row.to_stop_id,
    toStopName: row.to_stop_name,
    toTimezone: row.to_timezone,
    arrivalTime: row.arrival_time,
    arrivalSeconds: row.arrival_seconds,
  };
}

export class D1TransitStore implements TransitStore {
  constructor(private readonly database: D1Database) {}

  async findStopCandidates(
    input: FindStopCandidatesInput,
  ): Promise<readonly StopRecord[]> {
    const pattern = `%${escapeLike(input.normalizedQuery)}%`;
    const result = await this.database
      .prepare(
        `SELECT
           feed_id,
           stop_id,
           stop_name,
           stop_lat,
           stop_lon,
           timezone,
           location_type,
           parent_station,
           platform_code,
           wheelchair_boarding
         FROM stops
         WHERE stop_name LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR stop_id LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY
           CASE WHEN lower(stop_name) = ? THEN 0 ELSE 1 END,
           stop_name COLLATE NOCASE,
           feed_id,
           stop_id
         LIMIT ?`,
      )
      .bind(pattern, pattern, input.normalizedQuery, input.candidateLimit)
      .all<StopRow>();

    return result.results.map(mapStop);
  }

  async findStopsById(
    input: FindStopsByIdInput,
  ): Promise<readonly StopRecord[]> {
    const feedClause = input.feedId === undefined ? "" : "AND feed_id = ?";
    const result = await this.database
      .prepare(
        `SELECT
           feed_id,
           stop_id,
           stop_name,
           stop_lat,
           stop_lon,
           timezone,
           location_type,
           parent_station,
           platform_code,
           wheelchair_boarding
         FROM stops
         WHERE stop_id = ?
         ${feedClause}
         ORDER BY feed_id, stop_id
         LIMIT 50`,
      )
      .bind(input.stopId, ...(input.feedId === undefined ? [] : [input.feedId]))
      .all<StopRow>();

    return result.results.map(mapStop);
  }

  async findScheduledTrips(
    input: FindScheduledTripsInput,
  ): Promise<readonly ScheduledTripRecord[]> {
    const departureSeconds = gtfsSeconds("origin.departure_time");
    const hasDestination = input.toStopId !== undefined;
    const destinationJoin = hasDestination
      ? `JOIN stop_times destination
           ON destination.feed_id = origin.feed_id
          AND destination.trip_id = origin.trip_id
          AND destination.stop_id = ?
          AND destination.stop_sequence > origin.stop_sequence
          AND destination.stop_sequence = (
            SELECT MIN(next_destination.stop_sequence)
            FROM stop_times next_destination
            WHERE next_destination.feed_id = origin.feed_id
              AND next_destination.trip_id = origin.trip_id
              AND next_destination.stop_id = destination.stop_id
              AND next_destination.stop_sequence > origin.stop_sequence
          )
         JOIN stops destination_stop
           ON destination_stop.feed_id = destination.feed_id
          AND destination_stop.stop_id = destination.stop_id`
      : "";
    const destinationDropOff = hasDestination
      ? "AND COALESCE(destination.drop_off_type, 0) <> 1"
      : "";
    const destinationColumns = hasDestination
      ? `destination.stop_id AS to_stop_id,
         destination_stop.stop_name AS to_stop_name,
         COALESCE(destination_stop.timezone, origin_stop.timezone, 'UTC') AS to_timezone,
         destination.arrival_time AS arrival_time,
         ${gtfsSeconds("destination.arrival_time")} AS arrival_seconds`
      : `NULL AS to_stop_id,
         NULL AS to_stop_name,
         NULL AS to_timezone,
         NULL AS arrival_time,
         NULL AS arrival_seconds`;
    const route = input.route ?? null;
    const result = await this.database
      .prepare(
        `WITH active_services AS (
           SELECT service_id
           FROM calendar regular
           WHERE regular.feed_id = ?
             AND regular.start_date <= ?
             AND regular.end_date >= ?
             AND regular.${input.weekday} = 1
             AND NOT EXISTS (
               SELECT 1
               FROM calendar_dates removed
               WHERE removed.feed_id = regular.feed_id
                 AND removed.service_id = regular.service_id
                 AND removed.date = ?
                 AND removed.exception_type = 2
             )
           UNION
           SELECT added.service_id
           FROM calendar_dates added
           WHERE added.feed_id = ?
             AND added.date = ?
             AND added.exception_type = 1
         )
         SELECT
           origin.feed_id,
           trip.trip_id,
           trip.trip_short_name,
           trip.route_id,
           route.route_short_name,
           route.route_long_name,
           route.route_type,
           trip.trip_headsign,
           trip.direction_id,
           origin.stop_id AS from_stop_id,
           origin_stop.stop_name AS from_stop_name,
           COALESCE(origin_stop.timezone, 'UTC') AS from_timezone,
           origin.departure_time,
           ${departureSeconds} AS departure_seconds,
           ${destinationColumns}
         FROM stop_times origin
         JOIN stops origin_stop
           ON origin_stop.feed_id = origin.feed_id
          AND origin_stop.stop_id = origin.stop_id
         JOIN trips trip
           ON trip.feed_id = origin.feed_id
          AND trip.trip_id = origin.trip_id
         JOIN active_services active
           ON active.service_id = trip.service_id
         JOIN routes route
           ON route.feed_id = trip.feed_id
          AND route.route_id = trip.route_id
         ${destinationJoin}
         WHERE origin.feed_id = ?
           AND origin.stop_id = ?
           AND origin.departure_time IS NOT NULL
           AND COALESCE(origin.pickup_type, 0) <> 1
           ${destinationDropOff}
           AND ${departureSeconds} >= ?
           AND ${departureSeconds} <= ?
           AND (
             ? IS NULL
             OR lower(trip.route_id) = lower(?)
             OR lower(COALESCE(trip.trip_short_name, '')) = lower(?)
             OR lower(COALESCE(route.route_short_name, '')) = lower(?)
             OR lower(COALESCE(route.route_long_name, '')) LIKE '%' || lower(?) || '%'
           )
         ORDER BY departure_seconds, trip.trip_id
         LIMIT ?`,
      )
      .bind(
        input.feedId,
        input.serviceDate,
        input.serviceDate,
        input.serviceDate,
        input.feedId,
        input.serviceDate,
        ...(hasDestination ? [input.toStopId] : []),
        input.feedId,
        input.fromStopId,
        input.startSeconds,
        input.endSeconds,
        route,
        route,
        route,
        route,
        route,
        input.limit,
      )
      .all<ScheduledTripRow>();

    return result.results.map(mapScheduledTrip);
  }

  async getFeedVersions(
    feedIds: readonly string[],
  ): Promise<readonly FeedVersion[]> {
    if (feedIds.length === 0) {
      return [];
    }

    const placeholders = feedIds.map(() => "?").join(", ");
    const result = await this.database
      .prepare(
        `SELECT feed_id, MAX(ingested_at) AS ingested_at
         FROM feed_versions
         WHERE feed_id IN (${placeholders})
         GROUP BY feed_id`,
      )
      .bind(...feedIds)
      .all<FeedVersionRow>();

    return result.results.map((row) => ({
      feedId: row.feed_id,
      ingestedAt: row.ingested_at,
    }));
  }
}
