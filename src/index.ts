#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MobiliteitClient } from "./client.js";
import { startHttpServer } from "./http.js";
import { createMcpServer } from "./mcp-server.js";
import { DepartureStreams } from "./streams.js";

type TransportMode = "stdio" | "http" | "both";

function positiveIntegerEnvironment(
  name: string,
  fallback: number,
  minimum = 1,
): number {
  const configured = process.env[name];
  if (configured === undefined) {
    return fallback;
  }
  const value = Number(configured);
  if (
    configured.trim() === "" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}

function parseTransportMode(value: string | undefined): TransportMode {
  if (value === undefined || value === "stdio") {
    return "stdio";
  }
  if (value === "http" || value === "both") {
    return value;
  }
  throw new Error("MCP_TRANSPORT must be stdio, http, or both");
}

function readSecret(name: string): string | undefined {
  const value = process.env[name];
  const filePath = process.env[`${name}_FILE`];
  if (value !== undefined && filePath !== undefined) {
    throw new Error(`Set either ${name} or ${name}_FILE, not both`);
  }
  if (filePath !== undefined) {
    const secret = readFileSync(filePath, "utf8").trim();
    if (!secret) {
      throw new Error(`${name}_FILE points to an empty secret file`);
    }
    return secret;
  }
  return value;
}

async function main(): Promise<void> {
  const apiKey = readSecret("MOBILITEIT_API_KEY");
  if (!apiKey?.trim()) {
    throw new Error(
      "MOBILITEIT_API_KEY is required. Set it to an API key issued by the transport authority.",
    );
  }

  const mode = parseTransportMode(process.env.MCP_TRANSPORT);
  const client = new MobiliteitClient(apiKey, fetch, {
    maxRequestsPerMinute: positiveIntegerEnvironment(
      "MOBILITEIT_MAX_REQUESTS_PER_MINUTE",
      60,
    ),
  });
  const streams = new DepartureStreams(
    client,
    positiveIntegerEnvironment("MOBILITEIT_POLL_INTERVAL_SECONDS", 30, 15) *
      1_000,
    positiveIntegerEnvironment("MOBILITEIT_MAX_ACTIVE_FEEDS", 1),
  );
  const servers: ReturnType<typeof createMcpServer>[] = [];
  let httpHandle: Awaited<ReturnType<typeof startHttpServer>> | undefined;

  if (mode === "http" || mode === "both") {
    const bearerToken = readSecret("MCP_HTTP_BEARER_TOKEN");
    if (!bearerToken?.trim()) {
      throw new Error(
        "MCP_HTTP_BEARER_TOKEN is required when MCP_TRANSPORT is http or both",
      );
    }
    const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
    const port = positiveIntegerEnvironment("MCP_HTTP_PORT", 3000, 0);
    const allowedHosts =
      process.env.MCP_HTTP_ALLOWED_HOSTS?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? ["localhost", "127.0.0.1", "::1"];
    httpHandle = await startHttpServer(client, streams, {
      host,
      port,
      bearerToken,
      allowedHosts,
      sessionIdleTimeoutMs:
        positiveIntegerEnvironment("MCP_HTTP_SESSION_IDLE_TIMEOUT_SECONDS", 1800) *
        1_000,
      maxSessions: positiveIntegerEnvironment("MCP_HTTP_MAX_SESSIONS", 100),
    });
    console.error(`MCP Streamable HTTP listening on ${host}:${port}/mcp`);
  }

  if (mode === "stdio" || mode === "both") {
    const mcp = createMcpServer({ client, streams });
    servers.push(mcp);
    await mcp.server.connect(new StdioServerTransport());
  }

  const shutdown = async (): Promise<void> => {
    streams.close();
    for (const server of servers) {
      server.cleanup();
      await server.server.close();
    }
    if (httpHandle) {
      await httpHandle.close();
    }
  };

  const onSignal = (): void => {
    shutdown().then(
      () => {
        process.exitCode = 0;
      },
      (error: unknown) => {
        console.error(
          "Shutdown failed:",
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
