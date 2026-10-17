import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { MobiliteitClient } from "../src/client.js";
import { startHttpServer } from "../src/http.js";
import { createMcpServer } from "../src/server.js";
import { DepartureStreams } from "../src/streams.js";

function departureClient(fetchImplementation: typeof fetch): MobiliteitClient {
  return new MobiliteitClient("test-only-key", fetchImplementation);
}

function changingFetch(): { fetch: typeof fetch; calls: () => number } {
  let requestCount = 0;
  return {
    fetch: async () =>
      new Response(JSON.stringify({ departures: ++requestCount }), {
        headers: { "content-type": "application/json" },
      }),
    calls: () => requestCount,
  };
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 2_000);
    }),
  ]).finally(() => clearTimeout(timer));
}

test("resource subscriptions notify clients when departure data changes", async (t) => {
  const upstream = changingFetch();
  const client = new Client({ name: "stream-test-client", version: "1.0.0" });
  const streams = new DepartureStreams(
    departureClient(upstream.fetch),
    15_000,
    1,
    () => {},
  );
  const mcp = createMcpServer({
    client: departureClient(upstream.fetch),
    streams,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const updateReceived = new Promise<{ uri: string }>((resolve) => {
    client.setNotificationHandler(
      ResourceUpdatedNotificationSchema,
      ({ params }) => resolve(params),
    );
  });

  t.after(async () => {
    mcp.cleanup();
    streams.close();
    await client.close();
    await mcp.server.close();
  });

  await mcp.server.connect(serverTransport);
  await client.connect(clientTransport);

  const resourceUri = "mobiliteit://stops/A%3D1%40L%3D123%40/departures";
  const result = await client.readResource({ uri: resourceUri });
  assert.equal(upstream.calls(), 1);
  assert.ok("text" in result.contents[0]);
  const snapshot = JSON.parse(result.contents[0].text);
  assert.equal(snapshot.stopId, "A=1@L=123@");
  assert.equal(snapshot.data.departures, 1);

  await client.subscribeResource({ uri: resourceUri });
  const notification = await withTimeout(
    updateReceived,
    "Timed out waiting for feed update",
  );

  assert.deepEqual(notification, { uri: resourceUri });
  assert.equal(upstream.calls(), 2);
});

test("HTTP transport requires a bearer token and streams subscribed resource updates", async (t) => {
  const upstream = changingFetch();
  const client = departureClient(upstream.fetch);
  const streams = new DepartureStreams(client, 15_000, 1, () => {});
  const httpServer = await startHttpServer(client, streams, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "local-test-token",
  });
  const address = httpServer.server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const mcpClient = new Client({ name: "http-stream-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: {
      headers: { authorization: "Bearer local-test-token" },
    },
  });

  t.after(async () => {
    await mcpClient.close();
    streams.close();
    await httpServer.close();
  });

  const unauthorized = await fetch(endpoint, { method: "GET" });
  assert.equal(unauthorized.status, 401);
  const health = await fetch(new URL("/healthz", endpoint));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const updateReceived = new Promise<{ uri: string }>((resolve) => {
    mcpClient.setNotificationHandler(
      ResourceUpdatedNotificationSchema,
      ({ params }) => resolve(params),
    );
  });
  await mcpClient.connect(transport);

  const resourceUri = "mobiliteit://stops/stop-456/departures";
  await mcpClient.readResource({ uri: resourceUri });
  await mcpClient.subscribeResource({ uri: resourceUri });
  const notification = await withTimeout(
    updateReceived,
    "Timed out waiting for HTTP update",
  );

  assert.deepEqual(notification, { uri: resourceUri });
  assert.equal(upstream.calls(), 2);
});

test("active stop feeds are shared and capped", async () => {
  const upstream = changingFetch();
  const streams = new DepartureStreams(
    departureClient(upstream.fetch),
    15_000,
    1,
    () => {},
  );
  const releaseFirst = streams.subscribe("stop-1", () => {});
  const releaseSecond = streams.subscribe("stop-1", () => {});

  assert.throws(
    () => streams.subscribe("stop-2", () => {}),
    /active departure feed limit/,
  );
  releaseFirst();
  assert.throws(
    () => streams.subscribe("stop-2", () => {}),
    /active departure feed limit/,
  );
  releaseSecond();
  const releaseOther = streams.subscribe("stop-2", () => {});
  releaseOther();
  streams.close();
});

test("a failed poll marks the cached departure snapshot stale and recovery refreshes it", async () => {
  let fail = false;
  let notificationCount = 0;
  const streams = new DepartureStreams(
    {
      getDepartures: async () => {
        if (fail) {
          throw new Error("upstream unavailable");
        }
        return { departures: ["Bus 1"] };
      },
    },
    15_000,
    1,
    () => {},
  );
  const release = streams.subscribe("stop-789", () => {
    notificationCount += 1;
  });

  const initial = await streams.read("stop-789");
  assert.equal(initial.status, "ok");

  fail = true;
  await streams.refreshNow("stop-789");
  const stale = await streams.read("stop-789");
  assert.equal(stale.status, "stale");
  assert.equal(stale.error, "upstream unavailable");

  fail = false;
  await streams.refreshNow("stop-789");
  const recovered = await streams.read("stop-789");
  assert.equal(recovered.status, "ok");
  assert.equal(recovered.error, undefined);
  assert.ok(notificationCount >= 3);

  release();
  streams.close();
});

function waitFor(condition: () => boolean, message: string): Promise<void> {
  return withTimeout(
    (async () => {
      while (!condition()) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })(),
    message,
  );
}

function canSubscribe(streams: DepartureStreams, stopId: string): boolean {
  try {
    streams.subscribe(stopId, () => {})();
    return true;
  } catch {
    return false;
  }
}

test("one unsubscribe cancels a repeated subscription", async (t) => {
  const upstream = changingFetch();
  const streams = new DepartureStreams(
    departureClient(upstream.fetch),
    15_000,
    1,
    () => {},
  );
  const mcp = createMcpServer({ client: departureClient(upstream.fetch), streams });
  const client = new Client({ name: "unsubscribe-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  t.after(async () => {
    mcp.cleanup();
    streams.close();
    await client.close();
    await mcp.server.close();
  });
  await mcp.server.connect(serverTransport);
  await client.connect(clientTransport);

  const uri = "mobiliteit://stops/stop-1/departures";
  await client.subscribeResource({ uri });
  await client.subscribeResource({ uri });
  assert.equal(canSubscribe(streams, "stop-2"), false);
  await client.unsubscribeResource({ uri });
  assert.equal(canSubscribe(streams, "stop-2"), true);
});

test("health checks ignore the Host allowlist but MCP requests do not", async (t) => {
  const client = departureClient(changingFetch().fetch);
  const streams = new DepartureStreams(client, 15_000, 1, () => {});
  const httpServer = await startHttpServer(client, streams, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "local-test-token",
    allowedHosts: ["mcp.example.org"],
  });
  t.after(async () => {
    streams.close();
    await httpServer.close();
  });
  const address = httpServer.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  const mcp = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer local-test-token" },
  });
  assert.equal(mcp.status, 403);
});

test("abandoned HTTP sessions are closed and release their feeds", async (t) => {
  const client = departureClient(changingFetch().fetch);
  const streams = new DepartureStreams(client, 15_000, 1, () => {});
  const httpServer = await startHttpServer(client, streams, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "local-test-token",
    sessionIdleTimeoutMs: 50,
  });
  t.after(async () => {
    streams.close();
    await httpServer.close();
  });
  const address = httpServer.server.address();
  assert.ok(address && typeof address !== "string");
  const mcpClient = new Client({ name: "abandoning-client", version: "1.0.0" });
  await mcpClient.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers: { authorization: "Bearer local-test-token" } } },
    ),
  );
  await mcpClient.subscribeResource({
    uri: "mobiliteit://stops/stop-1/departures",
  });
  assert.equal(canSubscribe(streams, "stop-2"), false);

  // Closing the client drops its connections without sending DELETE, as a
  // crashed client would.
  await mcpClient.close();
  await waitFor(
    () => canSubscribe(streams, "stop-2"),
    "Timed out waiting for the idle session to close",
  );
});

test("new HTTP sessions are refused once the session cap is reached", async (t) => {
  const client = departureClient(changingFetch().fetch);
  const streams = new DepartureStreams(client, 15_000, 1, () => {});
  const httpServer = await startHttpServer(client, streams, {
    host: "127.0.0.1",
    port: 0,
    bearerToken: "local-test-token",
    maxSessions: 1,
  });
  const address = httpServer.server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const connect = async () => {
    const mcpClient = new Client({ name: "capped-client", version: "1.0.0" });
    await mcpClient.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { authorization: "Bearer local-test-token" } },
      }),
    );
    return mcpClient;
  };
  const first = await connect();
  t.after(async () => {
    await first.close();
    streams.close();
    await httpServer.close();
  });

  await assert.rejects(connect(), /503|Too many active MCP sessions/);
});
