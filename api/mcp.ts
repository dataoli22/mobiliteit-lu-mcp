// Stateless MCP endpoint for serverless hosts such as Vercel.
//
// Serves the lookup tools over Streamable HTTP without sessions. Live
// departure subscriptions need a long-running process, so they are only
// available from the Node server in src/index.ts (Docker / VPS).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isAuthorized } from "../src/auth.js";
import { MobiliteitClient } from "../src/client.js";
import { registerTools } from "../src/mcp-server.js";
import { SERVER_NAME, SERVER_VERSION } from "../src/version.js";

// Module scope, so warm instances share the client and its request cap.
let client: MobiliteitClient | undefined;

function getClient(): MobiliteitClient {
  const apiKey = process.env.MOBILITEIT_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "This server has no mobiliteit.lu API key configured yet, so it cannot look up transport data.",
    );
  }
  const limit = Number(process.env.MOBILITEIT_MAX_REQUESTS_PER_MINUTE ?? 60);
  client ??= new MobiliteitClient(apiKey, fetch, {
    maxRequestsPerMinute: Number.isSafeInteger(limit) && limit > 0 ? limit : 60,
  });
  return client;
}

function jsonError(status: number, error: string, headers: HeadersInit = {}): Response {
  return Response.json({ error }, { status, headers });
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.has("health")) {
    return Response.json({ status: "ok" });
  }

  const token = process.env.MCP_HTTP_BEARER_TOKEN?.trim();
  if (!token) {
    // Fail closed: never serve an unauthenticated endpoint by accident.
    return jsonError(503, "This endpoint is not configured yet.");
  }
  if (!isAuthorized(request.headers.get("authorization") ?? undefined, token)) {
    return jsonError(401, "Unauthorized", { "www-authenticate": "Bearer" });
  }
  if (request.method !== "POST") {
    // Stateless serving has no sessions to stream or delete.
    return jsonError(405, "Method not allowed", { allow: "POST" });
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, getClient);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export default { fetch: handleMcpRequest };
