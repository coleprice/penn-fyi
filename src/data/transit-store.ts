import type { FeedVersion, StopRecord } from "../types/gtfs";

export interface FindStopCandidatesInput {
  readonly normalizedQuery: string;
  readonly candidateLimit: number;
}

export interface TransitStore {
  findStopCandidates(
    input: FindStopCandidatesInput,
  ): Promise<readonly StopRecord[]>;
  getFeedVersions(feedIds: readonly string[]): Promise<readonly FeedVersion[]>;
}
