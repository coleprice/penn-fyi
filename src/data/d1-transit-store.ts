import type { FeedVersion, StopRecord } from "../types/gtfs";
import type { FindStopCandidatesInput, TransitStore } from "./transit-store";

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
