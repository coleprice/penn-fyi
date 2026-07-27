export type RealtimeCacheStatus = "hit" | "miss";

export interface RealtimeStationStatus {
  readonly stopId: string;
  readonly name: string;
  readonly timezone: string;
  readonly status: string;
  readonly scheduledArrival: string | null;
  readonly reportedArrival: string | null;
  readonly scheduledDeparture: string | null;
  readonly reportedDeparture: string | null;
  readonly platform: string | null;
}

export interface RealtimeTrainStatus {
  readonly trainId: string;
  readonly trainNumber: string;
  readonly routeName: string;
  readonly serviceDate: string | null;
  readonly trainState: string;
  readonly origin: {
    readonly stopId: string;
    readonly name: string;
    readonly timezone: string;
  };
  readonly destination: {
    readonly stopId: string;
    readonly name: string;
    readonly timezone: string;
  };
  readonly currentEvent: {
    readonly stopId: string;
    readonly name: string;
    readonly timezone: string;
  } | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly heading: string | null;
  readonly speedMph: number | null;
  readonly statusMessage: string | null;
  readonly observedAt: string | null;
  readonly updatedAt: string | null;
  readonly stations: readonly RealtimeStationStatus[];
  readonly alerts: readonly string[];
}

export interface RealtimeTripLookup {
  readonly trains: readonly RealtimeTrainStatus[];
  readonly fetchedAt: string;
  readonly cacheStatus: RealtimeCacheStatus;
  readonly sourceUrl: string;
}

export interface RealtimeTripProvider {
  lookup(identifier: string): Promise<RealtimeTripLookup>;
}
