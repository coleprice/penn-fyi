import { createMcpHandler } from "agents/mcp";

import { ingestNeeded, bearerToken, constantTimeTokenEqual } from "./admin";
import { D1TransitStore } from "./data/d1-transit-store";
import { FreshnessRepository } from "./freshness";
import { createTransitMcpServer } from "./mcp";
import { loadFeedRegistry } from "./registry";
import { TransitToolService } from "./tools/service";

function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function json(value: Record<string, unknown>, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const now = new Date();

    if (url.pathname === "/health") {
      return json({
        status: "ok",
        service: "penn-fyi",
        data_as_of: now.toISOString(),
      });
    }

    if (url.pathname === "/admin/ingest-needed") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { allow: "GET" },
        });
      }

      const authorized = await constantTimeTokenEqual(
        bearerToken(request),
        env.ADMIN_INGEST_TOKEN,
      );
      if (!authorized) {
        return json(
          {
            error: "unauthorized",
            data_as_of: now.toISOString(),
          },
          401,
        );
      }

      const registry = loadFeedRegistry();
      const freshness = new FreshnessRepository(env.TRANSIT_KV);
      return json(
        await ingestNeeded(registry, freshness, now, {
          staleAfterHours: positiveNumber(env.FEED_STALE_AFTER_HOURS, 48),
          recentQueryWindowDays: positiveNumber(
            env.RECENT_QUERY_WINDOW_DAYS,
            14,
          ),
        }),
      );
    }

    if (url.pathname === "/mcp") {
      const service = new TransitToolService(
        loadFeedRegistry(),
        new D1TransitStore(env.DB),
        new FreshnessRepository(env.TRANSIT_KV),
        { now: () => new Date() },
      );
      const server = createTransitMcpServer(service);
      return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
