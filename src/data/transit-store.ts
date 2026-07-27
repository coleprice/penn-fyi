import type {
  FeedVersion,
  ScheduledTripRecord,
  StopRecord,
} from "../types/gtfs";

export interface FindStopCandidatesInput {
  readonly normalizedQuery: string;
  readonly candidateLimit: number;
}

export interface FindStopsByIdInput {
  readonly stopId: string;
  readonly feedId?: string | undefined;
}

export type WeekdayColumn =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface FindScheduledTripsInput {
  readonly feedId: string;
  readonly fromStopId: string;
  readonly toStopId?: string | undefined;
  readonly serviceDate: string;
  readonly weekday: WeekdayColumn;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly route?: string | undefined;
  readonly limit: number;
}

export interface TransitStore {
  findStopCandidates(
    input: FindStopCandidatesInput,
  ): Promise<readonly StopRecord[]>;
  findStopsById(input: FindStopsByIdInput): Promise<readonly StopRecord[]>;
  findScheduledTrips(
    input: FindScheduledTripsInput,
  ): Promise<readonly ScheduledTripRecord[]>;
  getFeedVersions(feedIds: readonly string[]): Promise<readonly FeedVersion[]>;
}
