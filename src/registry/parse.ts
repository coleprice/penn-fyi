import type {
  BoundingBox,
  FeedAdapter,
  FeedDefinition,
  FeedFilter,
  FeedLicense,
  FeedRegistry,
  FeedStatus,
  LicenseStatus,
  RealtimeAuth,
  RealtimeEndpoints,
} from "../types/gtfs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Feed registry field "${field}" must be a non-empty string`,
    );
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);
  if (parsed === undefined) {
    throw new Error(`Feed registry field "${field}" is required`);
  }
  return parsed;
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim() !== "")
  ) {
    throw new Error(`Feed registry field "${field}" must be a string array`);
  }
  return value;
}

function parseStatus(value: unknown): FeedStatus {
  if (value === "operational" || value === "planned" || value === "discovery") {
    return value;
  }
  throw new Error(
    'Feed registry field "status" must be "operational", "planned", or "discovery"',
  );
}

function parseAdapter(value: unknown): FeedAdapter {
  if (value === "gtfs-static" || value === "amtraker") {
    return value;
  }
  throw new Error(
    'Feed registry field "adapter" must be "gtfs-static" or "amtraker"',
  );
}

function parseLicenseStatus(value: unknown): LicenseStatus {
  if (value === "verified" || value === "review_required") {
    return value;
  }
  throw new Error(
    'Feed registry field "license.status" must be "verified" or "review_required"',
  );
}

function parseLicense(value: unknown): FeedLicense {
  if (!isRecord(value) || typeof value.redistributable !== "boolean") {
    throw new Error(
      'Feed registry field "license.redistributable" must be a boolean',
    );
  }

  const name = optionalString(value.name, "license.name");
  const url = optionalString(value.url, "license.url");
  const notes = optionalString(value.notes, "license.notes");
  return {
    status: parseLicenseStatus(value.status),
    redistributable: value.redistributable,
    ...(name === undefined ? {} : { name }),
    ...(url === undefined ? {} : { url }),
    ...(notes === undefined ? {} : { notes }),
  };
}

function parseBbox(value: unknown): BoundingBox {
  if (!isRecord(value)) {
    throw new Error('Feed registry field "filter.bbox" must be an object');
  }
  const west = value.west;
  const south = value.south;
  const east = value.east;
  const north = value.north;
  if (![west, south, east, north].every((item) => typeof item === "number")) {
    throw new Error(
      'Feed registry field "filter.bbox" must contain numeric west, south, east, and north',
    );
  }
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number"
  ) {
    throw new Error('Feed registry field "filter.bbox" is invalid');
  }
  return { west, south, east, north };
}

function parseFilter(value: unknown): FeedFilter | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('Feed registry field "filter" must be an object');
  }

  const routeIds =
    value.route_ids === undefined
      ? undefined
      : stringArray(value.route_ids, "filter.route_ids");
  const routeShortNames =
    value.route_short_names === undefined
      ? undefined
      : stringArray(value.route_short_names, "filter.route_short_names");
  const bbox = value.bbox === undefined ? undefined : parseBbox(value.bbox);
  const serviceWindowDays = value.service_window_days;
  if (
    serviceWindowDays !== undefined &&
    (!Number.isInteger(serviceWindowDays) || Number(serviceWindowDays) < 1)
  ) {
    throw new Error(
      'Feed registry field "filter.service_window_days" must be a positive integer',
    );
  }

  return {
    ...(routeIds === undefined ? {} : { route_ids: routeIds }),
    ...(routeShortNames === undefined
      ? {}
      : { route_short_names: routeShortNames }),
    ...(bbox === undefined ? {} : { bbox }),
    ...(serviceWindowDays === undefined
      ? {}
      : { service_window_days: Number(serviceWindowDays) }),
  };
}

function parseRealtime(value: unknown): RealtimeEndpoints | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('Feed registry field "realtime" must be an object');
  }

  const tripUpdates =
    value.trip_updates === undefined
      ? undefined
      : stringArray(value.trip_updates, "realtime.trip_updates");
  const vehiclePositions =
    value.vehicle_positions === undefined
      ? undefined
      : stringArray(value.vehicle_positions, "realtime.vehicle_positions");
  const alerts =
    value.alerts === undefined
      ? undefined
      : stringArray(value.alerts, "realtime.alerts");
  if (
    tripUpdates === undefined &&
    vehiclePositions === undefined &&
    alerts === undefined
  ) {
    throw new Error(
      'Feed registry field "realtime" must contain at least one endpoint',
    );
  }

  const auth = requiredString(value.auth, "realtime.auth");
  if (auth !== "none" && !/^env:[A-Z][A-Z0-9_]*$/.test(auth)) {
    throw new Error(
      'Feed registry field "realtime.auth" must be "none" or "env:SECRET_NAME"',
    );
  }

  return {
    ...(tripUpdates === undefined ? {} : { trip_updates: tripUpdates }),
    ...(vehiclePositions === undefined
      ? {}
      : { vehicle_positions: vehiclePositions }),
    ...(alerts === undefined ? {} : { alerts }),
    auth: auth as RealtimeAuth,
  };
}

function parseFeed(value: unknown): FeedDefinition {
  if (!isRecord(value)) {
    throw new Error("Each feed registry entry must be an object");
  }

  const priority = value.priority;
  if (
    typeof priority !== "number" ||
    !Number.isInteger(priority) ||
    priority < 1 ||
    priority > 5
  ) {
    throw new Error(
      'Feed registry field "priority" must be an integer from 1 through 5',
    );
  }
  const downloadUrl = optionalString(value.download_url, "download_url");
  const secretName = optionalString(value.secret_name, "secret_name");
  const realtime = parseRealtime(value.realtime);
  const filter = parseFilter(value.filter);
  const notes = optionalString(value.notes, "notes");

  return {
    id: requiredString(value.id, "id"),
    agency_name: requiredString(value.agency_name, "agency_name"),
    region: requiredString(value.region, "region"),
    modes: stringArray(value.modes, "modes"),
    priority,
    status: parseStatus(value.status),
    adapter: parseAdapter(value.adapter),
    source_page: requiredString(value.source_page, "source_page"),
    license: parseLicense(value.license),
    ...(downloadUrl === undefined ? {} : { download_url: downloadUrl }),
    ...(secretName === undefined ? {} : { secret_name: secretName }),
    ...(realtime === undefined ? {} : { realtime }),
    ...(filter === undefined ? {} : { filter }),
    ...(notes === undefined ? {} : { notes }),
  };
}

export function parseFeedRegistry(value: unknown): FeedRegistry {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    typeof value.updated_at !== "string" ||
    !Array.isArray(value.feeds)
  ) {
    throw new Error('Feed registry root must contain a "feeds" array');
  }

  const feeds = value.feeds.map(parseFeed);
  const ids = new Set<string>();
  for (const feed of feeds) {
    if (ids.has(feed.id)) {
      throw new Error(`Duplicate feed id "${feed.id}"`);
    }
    ids.add(feed.id);
  }

  return {
    schema_version: 1,
    updated_at: value.updated_at,
    feeds,
  };
}
