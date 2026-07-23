import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FeedDefinition, FeedVersion } from "./types.ts";

interface CachedDownload {
  archivePath: string;
  etag?: string;
  lastModified?: string;
  sha256: string;
  sourceUrl: string;
}

export interface DownloadResult {
  archivePath: string;
  notModified: boolean;
  version: FeedVersion;
}

async function readCache(path: string): Promise<CachedDownload | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as CachedDownload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function responseFileName(url: string): string {
  const name = basename(new URL(url).pathname);
  return name.toLowerCase().endsWith(".zip") ? name : "gtfs.zip";
}

export async function downloadFeed(
  feed: FeedDefinition,
  sourceUrl: string,
  downloadRoot: string,
  stateRoot: string,
  now = new Date(),
): Promise<DownloadResult> {
  const provenanceUrl = feed.download_url ?? feed.source_page;
  await Promise.all([
    mkdir(downloadRoot, { recursive: true }),
    mkdir(stateRoot, { recursive: true }),
  ]);
  const cachePath = join(stateRoot, `${feed.id}.json`);
  const cached = await readCache(cachePath);
  const headers = new Headers({ Accept: "application/zip" });
  if (cached?.etag) headers.set("If-None-Match", cached.etag);
  if (cached?.lastModified) {
    headers.set("If-Modified-Since", cached.lastModified);
  }

  const response = await fetch(sourceUrl, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  const fetchedAt = now.toISOString();
  if (response.status === 304) {
    if (!cached)
      throw new Error(`${feed.id} returned 304 without cached state`);
    await readFile(cached.archivePath);
    return {
      archivePath: cached.archivePath,
      notModified: true,
      version: {
        versionId: cached.sha256.slice(0, 24),
        fetchedAt,
        ...(cached.etag ? { etag: cached.etag } : {}),
        ...(cached.lastModified ? { lastModified: cached.lastModified } : {}),
        sha256: cached.sha256,
        sourceUrl: provenanceUrl,
      },
    };
  }
  if (!response.ok) {
    throw new Error(
      `${feed.id} download failed: ${response.status} ${response.statusText}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 4 || bytes.subarray(0, 2).toString("hex") !== "504b") {
    throw new Error(`${feed.id} response is not a ZIP archive`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  if (cached?.sha256 === sha256) {
    const unchangedCache: CachedDownload = {
      archivePath: cached.archivePath,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      sha256,
      sourceUrl: provenanceUrl,
    };
    await writeFile(cachePath, `${JSON.stringify(unchangedCache, null, 2)}\n`);
    return {
      archivePath: cached.archivePath,
      notModified: true,
      version: {
        versionId: sha256.slice(0, 24),
        fetchedAt,
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
        sha256,
        sourceUrl: provenanceUrl,
      },
    };
  }
  const archivePath = join(
    downloadRoot,
    `${feed.id}-${sha256.slice(0, 16)}-${responseFileName(sourceUrl)}`,
  );
  await writeFile(archivePath, bytes, { flag: "wx" }).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
  const nextCache: CachedDownload = {
    archivePath,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
    sha256,
    sourceUrl: provenanceUrl,
  };
  await writeFile(cachePath, `${JSON.stringify(nextCache, null, 2)}\n`);
  return {
    archivePath,
    notModified: false,
    version: {
      versionId: sha256.slice(0, 24),
      fetchedAt,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      sha256,
      sourceUrl: provenanceUrl,
    },
  };
}
