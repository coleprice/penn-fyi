import { readFile } from "node:fs/promises";
import type {
  BoundingBox,
  FeedAdapter,
  FeedDefinition,
  FeedRegistry,
  FeedStatus,
  LicenseStatus,
  RealtimeAuth,
  RealtimeEndpoints,
} from "./types.ts";

const FEED_STATUSES = new Set<FeedStatus>([
  "operational",
  "planned",
  "discovery",
]);
const ADAPTERS = new Set<FeedAdapter>(["gtfs-static", "amtraker"]);
const LICENSE_STATUSES = new Set<LicenseStatus>([
  "verified",
  "review_required",
]);
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

function object(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function url(value: unknown, path: string): asserts value is string {
  string(value, path);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`${path} must use HTTPS`);
  }
}

function stringArray(value: unknown, path: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(`${path} must be a non-empty string array`);
  }
}

function httpsUrlArray(
  value: unknown,
  path: string,
): asserts value is string[] {
  stringArray(value, path);
  for (const [index, endpoint] of value.entries()) {
    url(endpoint, `${path}[${index}]`);
  }
}

function validateRealtime(value: unknown, path: string): RealtimeEndpoints {
  object(value, path);
  let endpointCount = 0;
  for (const key of ["trip_updates", "vehicle_positions", "alerts"] as const) {
    if (value[key] !== undefined) {
      httpsUrlArray(value[key], `${path}.${key}`);
      endpointCount += value[key].length;
    }
  }
  if (endpointCount === 0) {
    throw new Error(`${path} must contain at least one endpoint`);
  }
  string(value.auth, `${path}.auth`);
  if (value.auth !== "none" && !/^env:[A-Z][A-Z0-9_]*$/.test(value.auth)) {
    throw new Error(
      `${path}.auth must be "none" or an env:SECRET_NAME reference`,
    );
  }
  return value as unknown as RealtimeEndpoints;
}

function validateBbox(value: unknown, path: string): BoundingBox {
  object(value, path);
  const keys = ["west", "south", "east", "north"] as const;
  for (const key of keys) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
      throw new Error(`${path}.${key} must be a finite number`);
    }
  }
  const bbox = value as unknown as BoundingBox;
  if (bbox.west >= bbox.east || bbox.south >= bbox.north) {
    throw new Error(`${path} has inverted bounds`);
  }
  return bbox;
}

function validateFeed(value: unknown, index: number): FeedDefinition {
  const path = `feeds[${index}]`;
  object(value, path);
  string(value.id, `${path}.id`);
  if (!IDENTIFIER.test(value.id)) {
    throw new Error(`${path}.id must be a kebab-case identifier`);
  }
  string(value.agency_name, `${path}.agency_name`);
  string(value.region, `${path}.region`);
  stringArray(value.modes, `${path}.modes`);
  if (
    typeof value.priority !== "number" ||
    !Number.isInteger(value.priority) ||
    value.priority < 1 ||
    value.priority > 5
  ) {
    throw new Error(`${path}.priority must be an integer from 1 through 5`);
  }
  if (
    typeof value.status !== "string" ||
    !FEED_STATUSES.has(value.status as FeedStatus)
  ) {
    throw new Error(`${path}.status is invalid`);
  }
  if (
    typeof value.adapter !== "string" ||
    !ADAPTERS.has(value.adapter as FeedAdapter)
  ) {
    throw new Error(`${path}.adapter is invalid`);
  }
  url(value.source_page, `${path}.source_page`);

  if (value.download_url !== undefined) {
    string(value.download_url, `${path}.download_url`);
    const expanded = value.download_url.replace(/\$\{[A-Z][A-Z0-9_]*\}/g, "x");
    url(expanded, `${path}.download_url`);
  }
  if (value.secret_name !== undefined) {
    string(value.secret_name, `${path}.secret_name`);
    if (!SECRET_NAME.test(value.secret_name)) {
      throw new Error(
        `${path}.secret_name must be an environment variable name`,
      );
    }
    if (!value.download_url?.includes(`\${${value.secret_name}}`)) {
      throw new Error(
        `${path}.download_url must reference secret_name as a placeholder`,
      );
    }
  }
  if (
    value.status === "operational" &&
    value.adapter === "gtfs-static" &&
    value.download_url === undefined
  ) {
    throw new Error(`${path} is operational but has no download_url`);
  }
  if (value.realtime !== undefined) {
    validateRealtime(value.realtime, `${path}.realtime`);
  }

  object(value.license, `${path}.license`);
  if (
    typeof value.license.status !== "string" ||
    !LICENSE_STATUSES.has(value.license.status as LicenseStatus)
  ) {
    throw new Error(`${path}.license.status is invalid`);
  }
  if (typeof value.license.redistributable !== "boolean") {
    throw new Error(`${path}.license.redistributable must be boolean`);
  }
  if (value.license.url !== undefined) {
    url(value.license.url, `${path}.license.url`);
  }
  if (value.license.redistributable && value.license.status !== "verified") {
    throw new Error(
      `${path} cannot be redistributable before license verification`,
    );
  }

  if (value.filter !== undefined) {
    object(value.filter, `${path}.filter`);
    if (value.filter.bbox !== undefined) {
      validateBbox(value.filter.bbox, `${path}.filter.bbox`);
    }
    for (const key of [
      "agency_ids",
      "route_ids",
      "route_short_names",
    ] as const) {
      if (value.filter[key] !== undefined) {
        stringArray(value.filter[key], `${path}.filter.${key}`);
      }
    }
    if (
      value.filter.service_window_days !== undefined &&
      (typeof value.filter.service_window_days !== "number" ||
        !Number.isInteger(value.filter.service_window_days) ||
        value.filter.service_window_days < 1 ||
        value.filter.service_window_days > 400)
    ) {
      throw new Error(
        `${path}.filter.service_window_days must be an integer from 1 through 400`,
      );
    }
  }

  return value as unknown as FeedDefinition;
}

export function validateRegistry(value: unknown): FeedRegistry {
  object(value, "registry");
  if (value.schema_version !== 1) {
    throw new Error("registry.schema_version must be 1");
  }
  string(value.updated_at, "registry.updated_at");
  if (Number.isNaN(Date.parse(value.updated_at))) {
    throw new Error("registry.updated_at must be an ISO-8601 timestamp");
  }
  if (!Array.isArray(value.feeds) || value.feeds.length === 0) {
    throw new Error("registry.feeds must be a non-empty array");
  }
  const feeds = value.feeds.map(validateFeed);
  const ids = new Set<string>();
  for (const feed of feeds) {
    if (ids.has(feed.id)) {
      throw new Error(`duplicate feed id: ${feed.id}`);
    }
    ids.add(feed.id);
  }
  return {
    schema_version: 1,
    updated_at: value.updated_at,
    feeds,
  };
}

export async function loadRegistry(path: string): Promise<FeedRegistry> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return validateRegistry(raw);
}

export function expandDownloadUrl(feed: FeedDefinition): string {
  if (!feed.download_url) {
    throw new Error(`${feed.id} has no download URL`);
  }
  return feed.download_url.replace(
    /\$\{([A-Z][A-Z0-9_]*)\}/g,
    (_placeholder, name: string) => {
      const value = process.env[name];
      if (!value) {
        throw new Error(`${feed.id} requires environment variable ${name}`);
      }
      return encodeURIComponent(value);
    },
  );
}
