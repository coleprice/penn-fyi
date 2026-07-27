import { describe, expect, it } from "vitest";

import { AmtrakerRealtimeProvider } from "../src/realtime/amtraker";
import {
  RealtimeCache,
  type RealtimeCacheNamespace,
} from "../src/realtime/cache";

class MemoryNamespace implements RealtimeCacheNamespace {
  readonly values = new Map<string, string>();
  readonly expirationTtls: number[] = [];

  async get<ExpectedValue = unknown>(
    key: string,
    _options: { readonly type: "json" },
  ): Promise<ExpectedValue | null> {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as ExpectedValue);
  }

  async put(
    key: string,
    value: string,
    options: { readonly expirationTtl: number },
  ): Promise<void> {
    this.values.set(key, value);
    this.expirationTtls.push(options.expirationTtl);
  }
}

const rawTrain = {
  "43": [
    {
      routeName: "Pennsylvanian",
      trainNum: "43",
      trainID: "43-27",
      lat: 40.56,
      lon: -77.59,
      stations: [
        {
          name: "New York Penn",
          code: "NYP",
          tz: "America/New_York",
          schArr: "2026-07-27T10:52:00-04:00",
          schDep: "2026-07-27T10:52:00-04:00",
          arr: "2026-07-27T10:52:00-04:00",
          dep: "2026-07-27T10:52:00-04:00",
          status: "Departed",
          platform: "Track 7",
        },
        {
          name: "Huntingdon",
          code: "HGD",
          tz: "America/New_York",
          schArr: "2026-07-27T16:22:00-04:00",
          schDep: "2026-07-27T16:24:00-04:00",
          arr: "2026-07-27T16:33:00-04:00",
          dep: "2026-07-27T16:33:00-04:00",
          status: "Enroute",
          platform: "",
        },
      ],
      heading: "SW",
      eventCode: "HGD",
      eventTZ: "America/New_York",
      eventName: "Huntingdon",
      origCode: "NYP",
      originTZ: "America/New_York",
      origName: "New York Penn",
      destCode: "PGH",
      destTZ: "America/New_York",
      destName: "Pittsburgh",
      trainState: "Active",
      velocity: 62.3,
      statusMsg: " ",
      updatedAt: "2026-07-27T16:01:47-04:00",
      lastValTS: "2026-07-27T16:01:10-04:00",
      alerts: [{ message: "Test alert" }],
    },
  ],
};

describe("AmtrakerRealtimeProvider", () => {
  it("normalizes a bounded response and caches it for the configured window", async () => {
    const namespace = new MemoryNamespace();
    let now = new Date("2026-07-27T20:02:00.000Z");
    let fetches = 0;
    const body = JSON.stringify(rawTrain);
    const provider = new AmtrakerRealtimeProvider(
      new RealtimeCache(namespace, 25, { now: () => now }),
      async () => {
        fetches += 1;
        return new Response(body, {
          headers: { "content-length": String(body.length) },
        });
      },
    );

    const first = await provider.lookup("43");
    const second = await provider.lookup("43");

    expect(fetches).toBe(1);
    expect(first.cacheStatus).toBe("miss");
    expect(first.trains[0]).toMatchObject({
      trainId: "43-27",
      trainNumber: "43",
      serviceDate: "2026-07-27",
      currentEvent: { stopId: "HGD" },
      speedMph: 62.3,
      alerts: ["Test alert"],
      stations: [
        {
          stopId: "NYP",
          platform: "Track 7",
        },
        {
          stopId: "HGD",
          platform: null,
        },
      ],
    });
    expect(second.cacheStatus).toBe("hit");
    expect(namespace.expirationTtls).toEqual([75]);

    now = new Date("2026-07-27T20:02:26.000Z");
    await expect(provider.lookup("43")).resolves.toMatchObject({
      cacheStatus: "miss",
    });
    expect(fetches).toBe(2);
  });

  it("accepts Amtraker's empty-array not-found response", async () => {
    const provider = new AmtrakerRealtimeProvider(
      new RealtimeCache(new MemoryNamespace(), 25, {
        now: () => new Date("2026-07-27T20:02:00.000Z"),
      }),
      async () => Response.json([]),
    );

    await expect(provider.lookup("643")).resolves.toMatchObject({
      trains: [],
      cacheStatus: "miss",
    });
  });

  it("rejects oversized or unsupported upstream responses", async () => {
    const clock = { now: () => new Date("2026-07-27T20:02:00.000Z") };
    const oversized = new AmtrakerRealtimeProvider(
      new RealtimeCache(new MemoryNamespace(), 25, clock),
      async () =>
        new Response("{}", {
          headers: { "content-length": "1000001" },
        }),
    );
    const malformed = new AmtrakerRealtimeProvider(
      new RealtimeCache(new MemoryNamespace(), 25, clock),
      async () => Response.json({ unexpected: true }),
    );

    await expect(oversized.lookup("43")).rejects.toThrow(/size limit/);
    await expect(malformed.lookup("43")).rejects.toThrow(/unsupported/);
  });
});
