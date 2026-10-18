import assert from "node:assert/strict";
import test from "node:test";
import { MobiliteitClient } from "../src/client.js";

function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("requires an API key", () => {
  assert.throws(() => new MobiliteitClient("  "), /MOBILITEIT_API_KEY/);
  assert.throws(
    () => new MobiliteitClient("k".repeat(129)),
    /not be longer than 128/,
  );
});

test("nearby stops request uses documented endpoint and bounded options", async () => {
  let requestedUrl: URL | undefined;
  const client = new MobiliteitClient("secret-test-key", async (input) => {
    requestedUrl = new URL(String(input));
    return response(200, { StopLocation: [] });
  });

  const result = await client.findNearbyStops({
    latitude: 49.6116,
    longitude: 6.1319,
    radiusMeters: 500,
    limit: 5,
    language: "en",
  });

  assert.deepEqual(result, { StopLocation: [] });
  assert.equal(
    requestedUrl?.pathname,
    "/opendata/apiserver/location.nearbystops",
  );
  assert.equal(requestedUrl?.searchParams.get("accessId"), "secret-test-key");
  assert.equal(requestedUrl?.searchParams.get("originCoordLat"), "49.6116");
  assert.equal(requestedUrl?.searchParams.get("originCoordLong"), "6.1319");
  assert.equal(requestedUrl?.searchParams.get("maxNo"), "5");
  assert.equal(requestedUrl?.searchParams.get("format"), "json");
});

test("stop search queries location.name for stops only", async () => {
  let requestedUrl: URL | undefined;
  const client = new MobiliteitClient("secret-test-key", async (input) => {
    requestedUrl = new URL(String(input));
    return response(200, { stopLocationOrCoordLocation: [] });
  });

  await client.searchStops({ query: "Gare de Luxembourg", limit: 5, language: "en" });

  assert.equal(requestedUrl?.pathname, "/opendata/apiserver/location.name");
  assert.equal(requestedUrl?.searchParams.get("input"), "Gare de Luxembourg");
  assert.equal(requestedUrl?.searchParams.get("type"), "S");
  assert.equal(requestedUrl?.searchParams.get("maxNo"), "5");
});

test("departures request asks for real-time results and applies date and time", async () => {
  let requestedUrl: URL | undefined;
  const client = new MobiliteitClient("secret-test-key", async (input) => {
    requestedUrl = new URL(String(input));
    return response(200, { Departure: [] });
  });

  await client.getDepartures({
    stopId: "A=1@L=123456@",
    date: "2026-10-17",
    time: "12:30",
    durationMinutes: 30,
    limit: 15,
    language: "fr",
  });

  assert.equal(requestedUrl?.pathname, "/opendata/apiserver/departureBoard");
  assert.equal(requestedUrl?.searchParams.get("id"), "A=1@L=123456@");
  assert.equal(requestedUrl?.searchParams.get("date"), "2026-10-17");
  assert.equal(requestedUrl?.searchParams.get("time"), "12:30");
  assert.equal(requestedUrl?.searchParams.get("duration"), "30");
  assert.equal(requestedUrl?.searchParams.get("maxJourneys"), "15");
  assert.equal(requestedUrl?.searchParams.get("rtMode"), "SERVER_DEFAULT");
});

test("API errors report status without exposing the API key or response body", async () => {
  const client = new MobiliteitClient("secret-test-key", async () =>
    new Response("secret-test-key rejected", { status: 429 }),
  );

  await assert.rejects(
    client.findNearbyStops({
      latitude: 49.6,
      longitude: 6.1,
      radiusMeters: 1_000,
      limit: 10,
      language: "fr",
    }),
    (error: Error) => {
      assert.match(error.message, /HTTP 429/);
      assert.match(error.message, /quota/);
      assert.doesNotMatch(error.message, /secret-test-key/);
      return true;
    },
  );
});

test("invalid upstream JSON is surfaced as an error", async () => {
  const client = new MobiliteitClient("secret-test-key", async () =>
    new Response("not json", { status: 200 }),
  );

  await assert.rejects(
    client.findNearbyStops({
      latitude: 49.6,
      longitude: 6.1,
      radiusMeters: 1_000,
      limit: 10,
      language: "fr",
    }),
    /invalid JSON/,
  );
});

test("upstream requests are capped per rolling minute", async () => {
  let calls = 0;
  const client = new MobiliteitClient(
    "secret-test-key",
    async () => {
      calls += 1;
      return response(200, { StopLocation: [] });
    },
    { maxRequestsPerMinute: 2 },
  );
  const lookup = () =>
    client.findNearbyStops({
      latitude: 49.6,
      longitude: 6.1,
      radiusMeters: 1_000,
      limit: 10,
      language: "fr",
    });

  await lookup();
  await lookup();
  await assert.rejects(lookup(), /upstream request limit/);
  assert.equal(calls, 2);
});
