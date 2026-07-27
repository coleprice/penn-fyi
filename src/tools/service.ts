import type { TransitStore } from "../data/transit-store";
import type { FreshnessStore } from "../freshness";
import type {
  FeedDefinition,
  FeedRegistry,
  ScheduledTripRecord,
  StopRecord,
} from "../types/gtfs";

export interface Clock {
  now(): Date;
}

export interface NearPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly radius_km?: number | undefined;
}

export interface FindStopsInput {
  readonly query: string;
  readonly near?: NearPoint | undefined;
  readonly limit?: number | undefined;
}

export interface NextDeparturesInput {
  readonly from_stop: string;
  readonly to_stop?: string | undefined;
  readonly service_date?: string | undefined;
  readonly after_time?: string | undefined;
  readonly before_time?: string | undefined;
  readonly feed?: string | undefined;
  readonly route?: string | undefined;
  readonly limit?: number | undefined;
}

export interface StubToolResult extends Readonly<Record<string, unknown>> {
  readonly status: "not_available";
  readonly tool: string;
  readonly reason: string;
  readonly data_as_of: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_NEAR_CANDIDATES = 250;
const EARTH_RADIUS_KM = 6_371.0088;
const MAX_GTFS_TIME_SECONDS = 47 * 3600 + 59 * 60 + 59;
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function toIso(date: Date): string {
  return date.toISOString();
}

function latestIso(values: readonly (string | undefined)[]): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const time = Date.parse(value);
    if (!Number.isNaN(time) && time > latestTime) {
      latest = new Date(time).toISOString();
      latestTime = time;
    }
  }
  return latest;
}

function feedAvailability(
  feed: FeedDefinition,
  ingestedAt: string | undefined,
  freshnessStatus: string | undefined,
): "not_enabled" | "missing" | "ready" | "stale" {
  if (feed.status !== "operational") {
    return "not_enabled";
  }
  if (ingestedAt === undefined) {
    return "missing";
  }
  return freshnessStatus === "error" ? "stale" : "ready";
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function publicFeed(feed: FeedDefinition): Record<string, unknown> {
  return {
    id: feed.id,
    agency: feed.agency_name,
    region: feed.region,
    adapter: feed.adapter,
    priority: feed.priority,
    status: feed.status,
    modes: feed.modes,
    has_static_schedule: feed.download_url !== undefined,
    has_realtime: feed.realtime !== undefined,
    redistributable: feed.license.redistributable,
  };
}

function publicStop(
  stop: StopRecord,
  distance: number | null,
): Record<string, unknown> {
  return {
    feed_id: stop.feedId,
    stop_id: stop.stopId,
    name: stop.name,
    latitude: stop.latitude,
    longitude: stop.longitude,
    timezone: stop.timezone,
    location_type: stop.locationType,
    parent_station: stop.parentStation,
    platform_code: stop.platformCode,
    wheelchair_boarding: stop.wheelchairBoarding,
    ...(distance === null
      ? {}
      : { distance_km: Math.round(distance * 1_000) / 1_000 }),
  };
}

function validServiceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function timeSeconds(value: string): number {
  const match = /^(\d{2}):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (match === null) {
    throw new Error("times must use HH:MM or HH:MM:SS");
  }
  const hours = Number(match[1]);
  if (hours > 47) {
    throw new Error("GTFS schedule hours must be from 00 through 47");
  }
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3] ?? "0");
}

function localDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error(`could not format schedule time in ${timeZone}`);
  }
  return {
    serviceDate: `${year}-${month}-${day}`,
    seconds: Number(hour) * 3600 + Number(minute) * 60 + Number(second),
  };
}

function offsetMinutes(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  if (name === "GMT" || name === "UTC") {
    return 0;
  }
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "");
  if (match === null) {
    throw new Error(`could not determine UTC offset for ${timeZone}`);
  }
  const magnitude = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? magnitude : -magnitude;
}

function addDays(serviceDate: string, days: number): string {
  const date = new Date(`${serviceDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function scheduledIso(
  serviceDate: string,
  seconds: number,
  timeZone: string,
): string {
  const dayOffset = Math.floor(seconds / 86_400);
  const localSeconds = seconds % 86_400;
  const date = addDays(serviceDate, dayOffset);
  const hour = Math.floor(localSeconds / 3600);
  const minute = Math.floor((localSeconds % 3600) / 60);
  const second = localSeconds % 60;
  const [year, month, day] = date.split("-").map(Number);
  const localAsUtc = Date.UTC(year!, month! - 1, day!, hour, minute, second);
  let instant = new Date(localAsUtc);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    instant = new Date(localAsUtc - offsetMinutes(instant, timeZone) * 60_000);
  }
  const offset = offsetMinutes(instant, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offset);
  const offsetText = `${sign}${Math.floor(absoluteOffset / 60)
    .toString()
    .padStart(2, "0")}:${(absoluteOffset % 60).toString().padStart(2, "0")}`;
  return `${date}T${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}:${second.toString().padStart(2, "0")}${offsetText}`;
}

function publicScheduledTrip(
  trip: ScheduledTripRecord,
  serviceDate: string,
): Record<string, unknown> {
  const destination =
    trip.toStopId === null
      ? null
      : {
          stop_id: trip.toStopId,
          name: trip.toStopName,
          scheduled_arrival:
            trip.arrivalSeconds === null || trip.toTimezone === null
              ? null
              : scheduledIso(serviceDate, trip.arrivalSeconds, trip.toTimezone),
        };
  return {
    feed_id: trip.feedId,
    trip_id: trip.tripId,
    train_number: trip.tripShortName,
    route_id: trip.routeId,
    route_short_name: trip.routeShortName,
    route_long_name: trip.routeLongName,
    route_type: trip.routeType,
    headsign: trip.tripHeadsign,
    direction_id: trip.directionId,
    origin: {
      stop_id: trip.fromStopId,
      name: trip.fromStopName,
      scheduled_departure: scheduledIso(
        serviceDate,
        trip.departureSeconds,
        trip.fromTimezone,
      ),
    },
    destination,
    realtime: null,
    status: "scheduled",
  };
}

export class TransitToolService {
  constructor(
    private readonly registry: FeedRegistry,
    private readonly store: TransitStore,
    private readonly freshness: FreshnessStore,
    private readonly clock: Clock,
  ) {}

  async listFeeds(): Promise<Record<string, unknown>> {
    const feedIds = this.registry.feeds.map((feed) => feed.id);
    const [freshnessByFeed, versions] = await Promise.all([
      this.freshness.getMany(feedIds),
      this.store.getFeedVersions(feedIds),
    ]);
    const versionByFeed = new Map(
      versions.map((version) => [version.feedId, version.ingestedAt]),
    );

    const feeds = this.registry.feeds.map((feed) => {
      const freshness = freshnessByFeed.get(feed.id);
      const ingestedAt = freshness?.last_ingested ?? versionByFeed.get(feed.id);
      return {
        ...publicFeed(feed),
        availability: feedAvailability(feed, ingestedAt, freshness?.status),
        freshness: {
          status: freshness?.status ?? (ingestedAt ? "available" : "missing"),
          checked_at: freshness?.checked_at ?? null,
          last_ingested: ingestedAt ?? null,
          last_modified: freshness?.last_modified ?? null,
          last_queried: freshness?.last_queried ?? null,
          error: freshness?.error ?? null,
        },
      };
    });

    return {
      feeds,
      count: feeds.length,
      data_as_of: toIso(this.clock.now()),
    };
  }

  async findStops(input: FindStopsInput): Promise<Record<string, unknown>> {
    const normalizedQuery = input.query.trim().toLocaleLowerCase("en-US");
    if (normalizedQuery.length < 2) {
      throw new Error(
        "query must contain at least two non-whitespace characters",
      );
    }

    const limit = Math.min(
      Math.max(input.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const candidates = await this.store.findStopCandidates({
      normalizedQuery,
      candidateLimit:
        input.near === undefined
          ? limit
          : Math.min(Math.max(limit * 10, 100), MAX_NEAR_CANDIDATES),
    });

    const ranked = candidates
      .map((stop) => {
        const distance =
          input.near !== undefined &&
          stop.latitude !== null &&
          stop.longitude !== null
            ? distanceKm(
                input.near.latitude,
                input.near.longitude,
                stop.latitude,
                stop.longitude,
              )
            : null;
        return { stop, distance };
      })
      .filter(
        ({ distance }) =>
          input.near?.radius_km === undefined ||
          (distance !== null && distance <= input.near.radius_km),
      )
      .sort((left, right) => {
        if (input.near === undefined) {
          return 0;
        }
        return (
          (left.distance ?? Number.POSITIVE_INFINITY) -
          (right.distance ?? Number.POSITIVE_INFINITY)
        );
      })
      .slice(0, limit);

    const feedIds = [...new Set(ranked.map(({ stop }) => stop.feedId))];
    const versions = await this.store.getFeedVersions(feedIds);
    const queriedAt = toIso(this.clock.now());
    await this.freshness.recordQueries(feedIds, queriedAt);

    return {
      stops: ranked.map(({ stop, distance }) => publicStop(stop, distance)),
      count: ranked.length,
      query: input.query.trim(),
      near: input.near ?? null,
      data_as_of: latestIso(versions.map((version) => version.ingestedAt)),
    };
  }

  async nextDepartures(
    input: NextDeparturesInput,
  ): Promise<Record<string, unknown>> {
    const fromStopId = input.from_stop.trim();
    const toStopId = input.to_stop?.trim();
    const feedId = input.feed?.trim();
    if (fromStopId === "" || toStopId === "" || feedId === "") {
      throw new Error("stop and feed identifiers must not be blank");
    }

    if (
      input.service_date !== undefined &&
      !validServiceDate(input.service_date)
    ) {
      throw new Error("service_date must be a real date in YYYY-MM-DD form");
    }
    const limit = Math.min(
      Math.max(input.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const origins = await this.store.findStopsById({
      stopId: fromStopId,
      ...(feedId === undefined ? {} : { feedId }),
    });
    if (origins.length === 0) {
      return {
        departures: [],
        count: 0,
        query: {
          from_stop: fromStopId,
          to_stop: toStopId ?? null,
          service_date: input.service_date ?? null,
          feed: feedId ?? null,
          route: input.route ?? null,
        },
        data_as_of: null,
      };
    }

    const now = this.clock.now();
    const batches = await Promise.all(
      origins.map(async (origin) => {
        const timezone = origin.timezone ?? "UTC";
        const localNow = localDateTimeParts(now, timezone);
        const serviceDate = input.service_date ?? localNow.serviceDate;
        const startSeconds =
          input.after_time === undefined
            ? input.service_date === undefined
              ? localNow.seconds
              : 0
            : timeSeconds(input.after_time);
        const endSeconds =
          input.before_time === undefined
            ? MAX_GTFS_TIME_SECONDS
            : timeSeconds(input.before_time);
        if (endSeconds < startSeconds) {
          throw new Error("before_time must not be earlier than after_time");
        }
        const date = new Date(`${serviceDate}T00:00:00Z`);
        const weekday = WEEKDAYS[date.getUTCDay()];
        if (weekday === undefined) {
          throw new Error("could not determine service weekday");
        }
        const trips = await this.store.findScheduledTrips({
          feedId: origin.feedId,
          fromStopId,
          ...(toStopId === undefined ? {} : { toStopId }),
          serviceDate: serviceDate.replaceAll("-", ""),
          weekday,
          startSeconds,
          endSeconds,
          ...(input.route === undefined ? {} : { route: input.route.trim() }),
          limit,
        });
        return {
          serviceDate,
          trips,
        };
      }),
    );
    const departures = batches
      .flatMap((batch) =>
        batch.trips.map((trip) => ({
          public: publicScheduledTrip(trip, batch.serviceDate),
          instant: Date.parse(
            scheduledIso(
              batch.serviceDate,
              trip.departureSeconds,
              trip.fromTimezone,
            ),
          ),
        })),
      )
      .sort((left, right) => left.instant - right.instant)
      .slice(0, limit)
      .map((entry) => entry.public);
    const resultFeedIds = [
      ...new Set(
        departures.map((departure) => String(departure.feed_id ?? "")),
      ),
    ].filter(Boolean);
    const versions = await this.store.getFeedVersions(resultFeedIds);
    await this.freshness.recordQueries(resultFeedIds, toIso(now));

    return {
      departures,
      count: departures.length,
      query: {
        from_stop: fromStopId,
        to_stop: toStopId ?? null,
        service_date: input.service_date ?? null,
        after_time: input.after_time ?? null,
        before_time: input.before_time ?? null,
        feed: feedId ?? null,
        route: input.route ?? null,
      },
      realtime_included: false,
      data_as_of: latestIso(versions.map((version) => version.ingestedAt)),
    };
  }

  stub(tool: string, reason: string): StubToolResult {
    return {
      status: "not_available",
      tool,
      reason,
      data_as_of: toIso(this.clock.now()),
    };
  }
}
