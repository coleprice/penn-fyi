import { z } from "zod";

import { RealtimeCache } from "./cache";
import type {
  RealtimeStationStatus,
  RealtimeTrainStatus,
  RealtimeTripLookup,
  RealtimeTripProvider,
} from "./types";

const AMTRAKER_BASE_URL = "https://api.amtraker.com/v3/trains";
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 8_000;

const rawStationSchema = z
  .object({
    name: z.string(),
    code: z.string(),
    tz: z.string(),
    schArr: z.string().nullish(),
    schDep: z.string().nullish(),
    arr: z.string().nullish(),
    dep: z.string().nullish(),
    status: z.string().nullish(),
    platform: z.string().nullish(),
  })
  .passthrough();

const rawTrainSchema = z
  .object({
    routeName: z.string(),
    trainNum: z.string(),
    trainID: z.string(),
    lat: z.number().nullish(),
    lon: z.number().nullish(),
    stations: z.array(rawStationSchema),
    heading: z.string().nullish(),
    eventCode: z.string().nullish(),
    eventTZ: z.string().nullish(),
    eventName: z.string().nullish(),
    origCode: z.string(),
    originTZ: z.string(),
    origName: z.string(),
    destCode: z.string(),
    destTZ: z.string(),
    destName: z.string(),
    trainState: z.string(),
    velocity: z.number().nullish(),
    statusMsg: z.string().nullish(),
    updatedAt: z.string().nullish(),
    lastValTS: z.string().nullish(),
    alerts: z.array(z.object({ message: z.string() }).passthrough()).nullish(),
  })
  .passthrough();

const realtimeStationSchema = z.object({
  stopId: z.string(),
  name: z.string(),
  timezone: z.string(),
  status: z.string(),
  scheduledArrival: z.string().nullable(),
  reportedArrival: z.string().nullable(),
  scheduledDeparture: z.string().nullable(),
  reportedDeparture: z.string().nullable(),
  platform: z.string().nullable(),
});

const realtimeTrainSchema = z.object({
  trainId: z.string(),
  trainNumber: z.string(),
  routeName: z.string(),
  serviceDate: z.string().nullable(),
  trainState: z.string(),
  origin: z.object({
    stopId: z.string(),
    name: z.string(),
    timezone: z.string(),
  }),
  destination: z.object({
    stopId: z.string(),
    name: z.string(),
    timezone: z.string(),
  }),
  currentEvent: z
    .object({
      stopId: z.string(),
      name: z.string(),
      timezone: z.string(),
    })
    .nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  heading: z.string().nullable(),
  speedMph: z.number().nullable(),
  statusMessage: z.string().nullable(),
  observedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  stations: z.array(realtimeStationSchema),
  alerts: z.array(z.string()),
});

const realtimeTrainsSchema = z.array(realtimeTrainSchema);

type RawStation = z.infer<typeof rawStationSchema>;
type RawTrain = z.infer<typeof rawTrainSchema>;
type Fetcher = typeof fetch;

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function nullableTimestamp(value: string | null | undefined): string | null {
  const text = nullableText(value);
  return text !== null && !Number.isNaN(Date.parse(text)) ? text : null;
}

function stationStatus(station: RawStation): RealtimeStationStatus {
  return {
    stopId: station.code,
    name: station.name,
    timezone: station.tz,
    status: nullableText(station.status) ?? "Unknown",
    scheduledArrival: nullableTimestamp(station.schArr),
    reportedArrival: nullableTimestamp(station.arr),
    scheduledDeparture: nullableTimestamp(station.schDep),
    reportedDeparture: nullableTimestamp(station.dep),
    platform: nullableText(station.platform),
  };
}

function serviceDate(
  stations: readonly RealtimeStationStatus[],
): string | null {
  const first = stations[0];
  const timestamp =
    first?.scheduledDeparture ?? first?.scheduledArrival ?? null;
  return timestamp === null ? null : timestamp.slice(0, 10);
}

function trainStatus(train: RawTrain): RealtimeTrainStatus {
  const stations = train.stations.map(stationStatus);
  const eventCode = nullableText(train.eventCode);
  const eventStation =
    eventCode === null
      ? undefined
      : stations.find((station) => station.stopId === eventCode);
  const fallbackCurrentEvent =
    eventCode === null
      ? null
      : {
          stopId: eventCode,
          name: nullableText(train.eventName) ?? eventCode,
          timezone: nullableText(train.eventTZ) ?? "UTC",
        };

  return {
    trainId: train.trainID,
    trainNumber: train.trainNum,
    routeName: train.routeName,
    serviceDate: serviceDate(stations),
    trainState: train.trainState,
    origin: {
      stopId: train.origCode,
      name: train.origName,
      timezone: train.originTZ,
    },
    destination: {
      stopId: train.destCode,
      name: train.destName,
      timezone: train.destTZ,
    },
    currentEvent:
      eventStation === undefined
        ? fallbackCurrentEvent
        : {
            stopId: eventStation.stopId,
            name: eventStation.name,
            timezone: eventStation.timezone,
          },
    latitude: train.lat ?? null,
    longitude: train.lon ?? null,
    heading: nullableText(train.heading),
    speedMph: train.velocity ?? null,
    statusMessage: nullableText(train.statusMsg),
    observedAt: nullableTimestamp(train.lastValTS),
    updatedAt: nullableTimestamp(train.updatedAt),
    stations,
    alerts: (train.alerts ?? [])
      .map((alert) => alert.message.trim())
      .filter(Boolean),
  };
}

function parseRawResponse(value: unknown): readonly RealtimeTrainStatus[] {
  if (Array.isArray(value) && value.length === 0) {
    return [];
  }
  const parsed = z.record(z.string(), z.array(rawTrainSchema)).safeParse(value);
  if (!parsed.success) {
    throw new Error("Amtraker returned an unsupported response shape");
  }
  return Object.values(parsed.data).flatMap((trains) =>
    trains.map(trainStatus),
  );
}

function validateCachedTrains(
  value: unknown,
): readonly RealtimeTrainStatus[] | null {
  const parsed = realtimeTrainsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function boundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Amtraker response exceeded the size limit");
  }
  if (response.body === null) {
    throw new Error("Amtraker returned an empty response");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Amtraker response exceeded the size limit");
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export class AmtrakerRealtimeProvider implements RealtimeTripProvider {
  constructor(
    private readonly cache: RealtimeCache,
    private readonly fetcher: Fetcher,
  ) {}

  async lookup(identifier: string): Promise<RealtimeTripLookup> {
    const sourceUrl = `${AMTRAKER_BASE_URL}/${encodeURIComponent(identifier)}`;
    const cached = await this.cache.getOrLoad(
      `realtime:amtraker:train:${identifier.toLowerCase()}`,
      validateCachedTrains,
      async () => {
        const response = await this.fetcher(sourceUrl, {
          headers: {
            accept: "application/json",
            "user-agent": "penn.fyi/0.1 (+https://penn.fyi)",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`Amtraker returned HTTP ${response.status}`);
        }
        return parseRawResponse(
          await boundedJson(response, MAX_RESPONSE_BYTES),
        );
      },
    );

    return {
      trains: cached.value,
      fetchedAt: cached.fetchedAt,
      cacheStatus: cached.cacheStatus,
      sourceUrl,
    };
  }
}
