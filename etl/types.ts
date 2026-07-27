export type FeedStatus = "operational" | "planned" | "discovery";
export type FeedAdapter = "gtfs-static" | "amtraker";
export type LicenseStatus = "verified" | "review_required";

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface FeedFilter {
  bbox?: BoundingBox;
  agency_ids?: string[];
  route_ids?: string[];
  route_short_names?: string[];
  service_window_days?: number;
}

export interface FeedLicense {
  status: LicenseStatus;
  name?: string;
  url?: string;
  redistributable: boolean;
  notes?: string;
}

export type RealtimeAuth = "none" | `env:${string}`;

export interface RealtimeEndpoints {
  trip_updates?: string[];
  vehicle_positions?: string[];
  alerts?: string[];
  auth: RealtimeAuth;
}

export interface FeedDefinition {
  id: string;
  agency_name: string;
  region: string;
  modes: string[];
  priority: number;
  status: FeedStatus;
  adapter: FeedAdapter;
  source_page: string;
  download_url?: string;
  secret_name?: string;
  realtime?: RealtimeEndpoints;
  filter?: FeedFilter;
  license: FeedLicense;
  notes?: string;
}

export interface FeedRegistry {
  schema_version: 1;
  updated_at: string;
  feeds: FeedDefinition[];
}

export type CsvRow = Record<string, string>;

export interface GtfsTables {
  agency: CsvRow[];
  stops: CsvRow[];
  routes: CsvRow[];
  trips: CsvRow[];
  stop_times: CsvRow[];
  calendar: CsvRow[];
  calendar_dates: CsvRow[];
  feed_info: CsvRow[];
}

export interface FeedVersion {
  versionId: string;
  fetchedAt: string;
  publishedAt?: string;
  etag?: string;
  lastModified?: string;
  sha256: string;
  sourceUrl: string;
}
