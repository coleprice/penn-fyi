import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { downloadFeed } from "./download.ts";
import { filterGtfs, readGtfsZip } from "./gtfs.ts";
import { expandDownloadUrl, loadRegistry } from "./registry.ts";
import { generateSwapSql, summarizeTables } from "./sql.ts";

interface Options {
  feedIds: string[];
  registry: string;
  output: string;
  downloads: string;
  state: string;
  archive: string;
}

function options(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument near ${key ?? "(end)"}`);
    }
    values.set(key.slice(2), value);
  }
  return {
    feedIds: (values.get("feed") ?? "all")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    registry: resolve(values.get("registry") ?? "feeds.json"),
    output: resolve(values.get("output") ?? "etl/output"),
    downloads: resolve(values.get("downloads") ?? "etl/downloads"),
    state: resolve(values.get("state") ?? "etl/state"),
    archive: resolve(values.get("archive") ?? "etl/archive"),
  };
}

async function main(): Promise<void> {
  const config = options(process.argv.slice(2));
  const registry = await loadRegistry(config.registry);
  const wanted = config.feedIds.includes("all")
    ? registry.feeds.filter(
        (feed) =>
          feed.status === "operational" && feed.adapter === "gtfs-static",
      )
    : config.feedIds.map((id) => {
        const feed = registry.feeds.find((candidate) => candidate.id === id);
        if (!feed) throw new Error(`unknown feed: ${id}`);
        if (feed.status !== "operational" || feed.adapter !== "gtfs-static") {
          throw new Error(`${id} is not an operational static GTFS feed`);
        }
        return feed;
      });
  await Promise.all(
    [config.output, config.downloads, config.state, config.archive].map(
      (path) => mkdir(path, { recursive: true }),
    ),
  );

  const manifest: Array<Record<string, unknown>> = [];
  for (const feed of wanted) {
    const result = await downloadFeed(
      feed,
      expandDownloadUrl(feed),
      config.downloads,
      config.state,
    );
    if (result.notModified) {
      manifest.push({
        feed_id: feed.id,
        not_modified: true,
        version: result.version,
      });
      continue;
    }
    const rawArchive = join(
      config.archive,
      `${feed.id}-${result.version.sha256.slice(0, 16)}.zip`,
    );
    await cp(result.archivePath, rawArchive, { force: false }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const sourceTables = await readGtfsZip(result.archivePath);
    const filtered = filterGtfs(sourceTables, feed);
    const sqlPath = join(config.output, `${feed.id}.sql`);
    await writeFile(
      sqlPath,
      generateSwapSql(feed, filtered, result.version),
      "utf8",
    );
    manifest.push({
      feed_id: feed.id,
      sql_path: sqlPath,
      raw_archive_path: rawArchive,
      not_modified: false,
      version: result.version,
      rows: summarizeTables(filtered),
    });
  }
  await writeFile(
    join(config.output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

await main();
