import type { TransitStore } from "../data/transit-store";
import type { FreshnessStore } from "../freshness";
import type {
  RealtimeStationStatus,
  RealtimeTrainStatus,
  RealtimeTripProvider,
} from "../realtime/types";
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

export type StopReferenceInput = string | number;

export interface NextDeparturesInput {
  readonly from_stop?: StopReferenceInput | undefined;
  readonly stop?: StopReferenceInput | undefined;
  readonly to_stop?: StopReferenceInput | undefined;
  readonly service_date?: string | undefined;
  readonly after_time?: string | undefined;
  readonly before_time?: string | undefined;
  readonly feed?: string | undefined;
  readonly route?: string | undefined;
  readonly limit?: number | undefined;
}

export type TripIdentifierInput = string | number;

export interface TripStatusInput {
  readonly feed: string;
  readonly trip_or_train_number: TripIdentifierInput;
  readonly service_date?: string | undefined;
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
  if (feed.adapter === "amtraker") {
    return "ready";
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
    has_realtime: feed.realtime !== undefined || feed.adapter === "amtraker",
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

function identifierText(value: TripIdentifierInput): string {
  return typeof value === "number" ? String(value) : value.trim();
}

function stopReferenceText(value: StopReferenceInput): string {
  return typeof value === "number" ? String(value) : value.trim();
}

function parsedStopReference(
  value: StopReferenceInput,
  feedIds: ReadonlySet<string>,
): { readonly stopId: string; readonly feedId?: string | undefined } {
  const reference = stopReferenceText(value);
  if (reference === "") {
    throw new Error("stop identifiers must not be blank");
  }
  const separator = reference.indexOf(":");
  if (separator > 0) {
    const possibleFeedId = reference.slice(0, separator);
    if (feedIds.has(possibleFeedId)) {
      const stopId = reference.slice(separator + 1).trim();
      if (stopId === "") {
        throw new Error("compound stop references must include a stop ID");
      }
      return { stopId, feedId: possibleFeedId };
    }
  }
  return { stopId: reference };
}

function oneFeedId(
  values: readonly (string | undefined)[],
): string | undefined {
  const feedIds = [...new Set(values.filter((value) => value !== undefined))];
  if (feedIds.length > 1) {
    throw new Error("feed, from_stop, and to_stop must refer to the same feed");
  }
  return feedIds[0];
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

function delayMinutes(
  scheduled: string | null,
  reported: string | null,
): number | null {
  if (scheduled === null || reported === null) {
    return null;
  }
  const scheduledTime = Date.parse(scheduled);
  const reportedTime = Date.parse(reported);
  if (Number.isNaN(scheduledTime) || Number.isNaN(reportedTime)) {
    return null;
  }
  return Math.round((reportedTime - scheduledTime) / 60_000);
}

function currentDelayMinutes(train: RealtimeTrainStatus): number | null {
  const current =
    train.currentEvent === null
      ? undefined
      : train.stations.find(
          (station) => station.stopId === train.currentEvent?.stopId,
        );
  if (current === undefined) {
    return null;
  }
  return (
    delayMinutes(current.scheduledDeparture, current.reportedDeparture) ??
    delayMinutes(current.scheduledArrival, current.reportedArrival)
  );
}

function publicRealtimeStation(
  station: RealtimeStationStatus,
): Record<string, unknown> {
  return {
    stop_id: station.stopId,
    name: station.name,
    timezone: station.timezone,
    status: station.status,
    scheduled_arrival: station.scheduledArrival,
    reported_arrival: station.reportedArrival,
    arrival_delay_minutes: delayMinutes(
      station.scheduledArrival,
      station.reportedArrival,
    ),
    scheduled_departure: station.scheduledDeparture,
    reported_departure: station.reportedDeparture,
    departure_delay_minutes: delayMinutes(
      station.scheduledDeparture,
      station.reportedDeparture,
    ),
    platform: station.platform,
  };
}

function publicRealtimeTrain(
  train: RealtimeTrainStatus,
): Record<string, unknown> {
  return {
    train_id: train.trainId,
    train_number: train.trainNumber,
    route_name: train.routeName,
    service_date: train.serviceDate,
    train_state: train.trainState,
    delay_minutes: currentDelayMinutes(train),
    origin: {
      stop_id: train.origin.stopId,
      name: train.origin.name,
      timezone: train.origin.timezone,
    },
    destination: {
      stop_id: train.destination.stopId,
      name: train.destination.name,
      timezone: train.destination.timezone,
    },
    current_event:
      train.currentEvent === null
        ? null
        : {
            stop_id: train.currentEvent.stopId,
            name: train.currentEvent.name,
            timezone: train.currentEvent.timezone,
          },
    position:
      train.latitude === null || train.longitude === null
        ? null
        : {
            latitude: train.latitude,
            longitude: train.longitude,
            heading: train.heading,
            speed_mph: train.speedMph,
            observed_at: train.observedAt,
          },
    status_message: train.statusMessage,
    alerts: train.alerts,
    station_times: train.stations.map(publicRealtimeStation),
    data_as_of: train.observedAt ?? train.updatedAt,
  };
}

export class TransitToolService {
  constructor(
    private readonly registry: FeedRegistry,
    private readonly store: TransitStore,
    private readonly freshness: FreshnessStore,
    private readonly clock: Clock,
    private readonly realtime?: RealtimeTripProvider | undefined,
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
      const onDemand = feed.adapter === "amtraker";
      return {
        ...publicFeed(feed),
        availability: feedAvailability(feed, ingestedAt, freshness?.status),
        freshness: {
          status:
            freshness?.status ??
            (ingestedAt ? "available" : onDemand ? "on_demand" : "missing"),
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
    if (input.from_stop !== undefined && input.stop !== undefined) {
      throw new Error(
        "use from_stop; do not send both from_stop and the legacy stop alias",
      );
    }
    const originInput = input.from_stop ?? input.stop;
    if (originInput === undefined) {
      throw new Error("from_stop is required; legacy clients may send stop");
    }
    const explicitFeedId = input.feed?.trim();
    if (explicitFeedId === "") {
      throw new Error("feed identifiers must not be blank");
    }
    const knownFeedIds = new Set(
      this.registry.feeds.map((definition) => definition.id),
    );
    const origin = parsedStopReference(originInput, knownFeedIds);
    const destination =
      input.to_stop === undefined
        ? undefined
        : parsedStopReference(input.to_stop, knownFeedIds);
    const feedId = oneFeedId([
      explicitFeedId,
      origin.feedId,
      destination?.feedId,
    ]);
    const fromStopId = origin.stopId;
    const toStopId = destination?.stopId;

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

  async tripStatus(input: TripStatusInput): Promise<Record<string, unknown>> {
    const feedId = input.feed.trim().toLocaleLowerCase("en-US");
    if (feedId !== "amtrak" && feedId !== "amtrak-amtraker") {
      return this.stub(
        "trip_status",
        `Realtime trip status is not implemented for feed "${input.feed.trim()}".`,
      );
    }
    const identifier = identifierText(input.trip_or_train_number);
    if (!/^[a-z0-9-]{1,32}$/i.test(identifier)) {
      throw new Error(
        "trip_or_train_number must contain 1–32 letters, numbers, or hyphens",
      );
    }
    if (
      input.service_date !== undefined &&
      !validServiceDate(input.service_date)
    ) {
      throw new Error("service_date must be a real date in YYYY-MM-DD form");
    }
    if (this.realtime === undefined) {
      return this.stub(
        "trip_status",
        "The Amtrak realtime adapter is not configured.",
      );
    }

    const now = this.clock.now();
    try {
      await this.freshness.recordQueries(["amtrak"], toIso(now));
    } catch (error) {
      console.warn({
        event: "trip_status_freshness_write_failed",
        feed_id: "amtrak",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    try {
      const lookup = await this.realtime.lookup(identifier);
      const matches =
        input.service_date === undefined
          ? lookup.trains
          : lookup.trains.filter(
              (train) => train.serviceDate === input.service_date,
            );
      const dataAsOf =
        latestIso(
          matches.flatMap((train) => [
            train.observedAt ?? undefined,
            train.updatedAt ?? undefined,
          ]),
        ) ?? lookup.fetchedAt;
      const ageSeconds = Math.max(
        0,
        Math.floor((now.getTime() - Date.parse(dataAsOf)) / 1_000),
      );
      const publicMatches = matches.map(publicRealtimeTrain);

      return {
        status:
          matches.length === 0
            ? "not_found"
            : matches.length > 1
              ? "ambiguous"
              : matches[0]?.trainState.toLocaleLowerCase("en-US") || "found",
        feed_id: "amtrak",
        realtime_source_id: "amtrak-amtraker",
        train_or_trip: identifier,
        service_date: input.service_date ?? null,
        matches: publicMatches,
        count: publicMatches.length,
        ...(matches.length === 0
          ? {
              reason:
                "No matching active or predeparture Amtrak train is currently published by Amtraker.",
            }
          : {}),
        source: {
          name: "Amtraker",
          official: false,
          attribution: "Realtime data provided by Amtraker.",
          url: lookup.sourceUrl,
        },
        cache_status: lookup.cacheStatus,
        retrieved_at: lookup.fetchedAt,
        source_age_seconds: ageSeconds,
        stale: ageSeconds > 300,
        data_as_of: dataAsOf,
      };
    } catch (error) {
      console.warn({
        event: "trip_status_upstream_failed",
        feed_id: "amtrak",
        identifier,
        error: error instanceof Error ? error.name : "unknown",
      });
      return {
        status: "unavailable",
        tool: "trip_status",
        feed_id: "amtrak",
        train_or_trip: identifier,
        reason:
          "The unofficial Amtraker realtime source is temporarily unavailable or returned unsupported data.",
        source: {
          name: "Amtraker",
          official: false,
        },
        data_as_of: toIso(now),
      };
    }
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
