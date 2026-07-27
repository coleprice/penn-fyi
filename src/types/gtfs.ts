export type FeedStatus = "operational" | "planned" | "discovery";
export type FeedAdapter = "gtfs-static" | "amtraker";
export type LicenseStatus = "verified" | "review_required";

export interface BoundingBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface FeedFilter {
  readonly bbox?: BoundingBox;
  readonly agency_ids?: readonly string[];
  readonly route_ids?: readonly string[];
  readonly route_short_names?: readonly string[];
  readonly service_window_days?: number;
}

export interface FeedLicense {
  readonly status: LicenseStatus;
  readonly name?: string;
  readonly url?: string;
  readonly redistributable: boolean;
  readonly notes?: string;
}

export type RealtimeAuth = "none" | `env:${string}`;

export interface RealtimeEndpoints {
  readonly trip_updates?: readonly string[];
  readonly vehicle_positions?: readonly string[];
  readonly alerts?: readonly string[];
  readonly auth: RealtimeAuth;
}

export interface FeedDefinition {
  readonly id: string;
  readonly agency_name: string;
  readonly region: string;
  readonly modes: readonly string[];
  readonly priority: number;
  readonly status: FeedStatus;
  readonly adapter: FeedAdapter;
  readonly source_page: string;
  readonly download_url?: string;
  readonly secret_name?: string;
  readonly realtime?: RealtimeEndpoints;
  readonly filter?: FeedFilter;
  readonly license: FeedLicense;
  readonly notes?: string;
}

export interface FeedRegistry {
  readonly schema_version: 1;
  readonly updated_at: string;
  readonly feeds: readonly FeedDefinition[];
}

export interface StopRecord {
  readonly feedId: string;
  readonly stopId: string;
  readonly name: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timezone: string | null;
  readonly locationType: number | null;
  readonly parentStation: string | null;
  readonly platformCode: string | null;
  readonly wheelchairBoarding: number | null;
}

export interface ScheduledTripRecord {
  readonly feedId: string;
  readonly tripId: string;
  readonly tripShortName: string | null;
  readonly routeId: string;
  readonly routeShortName: string | null;
  readonly routeLongName: string | null;
  readonly routeType: number;
  readonly tripHeadsign: string | null;
  readonly directionId: number | null;
  readonly fromStopId: string;
  readonly fromStopName: string;
  readonly fromTimezone: string;
  readonly departureTime: string;
  readonly departureSeconds: number;
  readonly toStopId: string | null;
  readonly toStopName: string | null;
  readonly toTimezone: string | null;
  readonly arrivalTime: string | null;
  readonly arrivalSeconds: number | null;
}

export interface FeedVersion {
  readonly feedId: string;
  readonly ingestedAt: string;
}

export interface FeedFreshness {
  readonly feed_id: string;
  readonly status: string;
  readonly checked_at?: string;
  readonly last_ingested?: string;
  readonly etag?: string;
  readonly last_modified?: string;
  readonly version_id?: string;
  readonly last_queried?: string | null;
  readonly error?: string;
}
