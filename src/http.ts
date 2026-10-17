import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as NodeServer,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isAuthorized } from "./auth.js";
import type { MobiliteitClient } from "./client.js";
import { createMcpServer } from "./mcp-server.js";
import { DepartureStreams } from "./streams.js";

const MCP_PATH = "/mcp";
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_SESSIONS = 100;

export type HttpServerOptions = {
  host: string;
  port: number;
  bearerToken: string;
  allowedHosts?: string[];
  /** Close a session after this long with no open requests or streams. */
  sessionIdleTimeoutMs?: number;
  maxSessions?: number;
};

type Session = {
  transport: StreamableHTTPServerTransport;
  cleanup: () => void;
  openRequests: number;
  closed: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
};

export type RunningHttpServer = {
  server: NodeServer;
  close: () => Promise<void>;
};

export async function startHttpServer(
  client: MobiliteitClient,
  streams: DepartureStreams,
  options: HttpServerOptions,
): Promise<RunningHttpServer> {
  if (!options.bearerToken.trim()) {
    throw new Error("MCP_HTTP_BEARER_TOKEN is required for HTTP transport");
  }

  const allowedHosts = new Set(
    (options.allowedHosts ?? ["localhost", "127.0.0.1", "::1"]).map(
      normalizeHostname,
    ),
  );
  const sessionIdleTimeoutMs =
    options.sessionIdleTimeoutMs ?? DEFAULT_SESSION_IDLE_TIMEOUT_MS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const sessions = new Map<string, Session>();

  // A session stays alive while it has an open request or SSE stream. Once the
  // last one closes (including a client that vanished), the idle timer starts,
  // so abandoned sessions release their departure feeds instead of polling
  // upstream forever.
  function trackRequest(session: Session, response: ServerResponse): void {
    session.openRequests += 1;
    clearTimeout(session.idleTimer);
    response.once("close", () => {
      session.openRequests -= 1;
      if (session.openRequests === 0 && !session.closed) {
        session.idleTimer = setTimeout(() => {
          session.transport.close().catch((error: unknown) => {
            console.error(
              "Failed to close idle MCP session:",
              error instanceof Error ? error.message : String(error),
            );
          });
        }, sessionIdleTimeoutMs);
        session.idleTimer.unref();
      }
    });
  }
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      console.error(
        "MCP HTTP request failed:",
        error instanceof Error ? error.message : String(error),
      );
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
      }
      if (!response.writableEnded) {
        response.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  });

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    // Answered before the Host check so container healthchecks work whatever
    // MCP_HTTP_ALLOWED_HOSTS contains; it exposes nothing.
    if (url.pathname === "/healthz" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (!isAllowedHost(request.headers.host, allowedHosts)) {
      response.writeHead(403).end();
      return;
    }
    if (url.pathname !== MCP_PATH) {
      response.writeHead(404).end();
      return;
    }
    if (!isAuthorized(request.headers.authorization, options.bearerToken)) {
      response.writeHead(401, {
        "www-authenticate": "Bearer",
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (!["GET", "POST", "DELETE"].includes(request.method ?? "")) {
      response.writeHead(405, { allow: "GET, POST, DELETE" }).end();
      return;
    }

    const sessionId = request.headers["mcp-session-id"];
    if (typeof sessionId === "string") {
      const session = sessions.get(sessionId);
      if (!session) {
        response.writeHead(404).end();
        return;
      }
      trackRequest(session, response);
      await session.transport.handleRequest(request, response);
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(400, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ error: "Initialize an MCP session first" }));
      return;
    }
    if (sessions.size >= maxSessions) {
      response.writeHead(503, {
        "content-type": "application/json",
        "retry-after": "60",
      });
      response.end(JSON.stringify({ error: "Too many active MCP sessions" }));
      return;
    }

    let initializedSessionId: string | undefined;
    const mcp = createMcpServer({ client, streams });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        initializedSessionId = id;
        sessions.set(id, session);
      },
    });
    const session: Session = {
      transport,
      cleanup: mcp.cleanup,
      openRequests: 0,
      closed: false,
    };
    // Assigned before connect() so the SDK chains its own close handler.
    transport.onclose = () => {
      session.closed = true;
      clearTimeout(session.idleTimer);
      if (initializedSessionId) {
        sessions.delete(initializedSessionId);
      }
      session.cleanup();
    };
    await mcp.server.connect(transport);
    trackRequest(session, response);
    try {
      await transport.handleRequest(request, response);
    } finally {
      if (!initializedSessionId) {
        mcp.cleanup();
        await mcp.server.close();
      }
    }
  }

  async function close(): Promise<void> {
    for (const [sessionId, session] of sessions) {
      sessions.delete(sessionId);
      clearTimeout(session.idleTimer);
      session.cleanup();
      await session.transport.close();
    }
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  return { server: httpServer, close };
}

function isAllowedHost(
  hostHeader: string | undefined,
  allowedHosts: Set<string>,
): boolean {
  if (!hostHeader) {
    return false;
  }
  try {
    return allowedHosts.has(
      normalizeHostname(new URL(`http://${hostHeader}`).hostname),
    );
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}
