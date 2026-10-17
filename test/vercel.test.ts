import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcpRequest } from "../api/mcp.js";

const ENDPOINT = "https://example.test/api/mcp";
const TOKEN = "vercel-test-token";

function withEnv(t: test.TestContext, values: Record<string, string | undefined>): void {
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function connect(t: test.TestContext): Promise<Client> {
  const client = new Client({ name: "vercel-test", version: "1.0.0" });
  // Route the MCP client's HTTP calls straight into the handler.
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    fetch: (input, init) => handleMcpRequest(new Request(input, init)),
  });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

test("serverless endpoint fails closed until a bearer token is configured", async (t) => {
  withEnv(t, { MCP_HTTP_BEARER_TOKEN: undefined });
  const response = await handleMcpRequest(new Request(ENDPOINT, { method: "POST" }));
  assert.equal(response.status, 503);
});

test("serverless endpoint rejects a wrong token and answers health checks", async (t) => {
  withEnv(t, { MCP_HTTP_BEARER_TOKEN: TOKEN });
  const wrong = await handleMcpRequest(
    new Request(ENDPOINT, { method: "POST", headers: { authorization: "Bearer nope" } }),
  );
  assert.equal(wrong.status, 401);
  const health = await handleMcpRequest(new Request(`${ENDPOINT}?health=1`));
  assert.deepEqual(await health.json(), { status: "ok" });
});

test("serverless endpoint lists the tools and reports a missing API key as a tool error", async (t) => {
  withEnv(t, { MCP_HTTP_BEARER_TOKEN: TOKEN, MOBILITEIT_API_KEY: undefined });
  const client = await connect(t);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["find_nearby_stops", "get_departures"]);

  const result = await client.callTool({
    name: "find_nearby_stops",
    arguments: { latitude: 49.6, longitude: 6.13 },
  });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /no mobiliteit\.lu API key/);
});

test("serverless endpoint calls the upstream API when a key is configured", async (t) => {
  withEnv(t, { MCP_HTTP_BEARER_TOKEN: TOKEN, MOBILITEIT_API_KEY: "test-only-key" });
  const realFetch = globalThis.fetch;
  let upstreamUrl: URL | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "cdt.hafas.de") return realFetch(input, init);
    upstreamUrl = url;
    return Response.json({ stopLocationOrCoordLocation: [] });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const client = await connect(t);

  const result = await client.callTool({
    name: "find_nearby_stops",
    arguments: { latitude: 49.6, longitude: 6.13 },
  });
  assert.notEqual(result.isError, true);
  assert.equal(upstreamUrl?.pathname, "/opendata/apiserver/location.nearbystops");
  assert.equal(upstreamUrl?.searchParams.get("accessId"), "test-only-key");
});
