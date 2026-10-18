import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ErrorCode,
  McpError,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { MobiliteitClient } from "./client.js";
import { DepartureStreams } from "./streams.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

const RESOURCE_URI_TEMPLATE = "mobiliteit://stops/{stopId}/departures";
const MAX_STOP_ID_LENGTH = 512;

export type ServerDependencies = {
  client: MobiliteitClient;
  streams: DepartureStreams;
};

/**
 * Registers the stateless lookup tools. Shared by the long-running server and
 * the serverless endpoint; getClient may throw when no API key is configured,
 * which the SDK reports to the caller as a tool error.
 */
export function registerTools(
  server: McpServer,
  getClient: () => MobiliteitClient,
): void {
  server.registerTool(
    "find_nearby_stops",
    {
      title: "Find nearby public transport stops",
      description:
        "Find public transport stops near a WGS84 coordinate in Luxembourg. Use the returned stop id with get_departures or subscribe to its departure resource.",
      inputSchema: {
        latitude: z.number().min(-90).max(90).describe("Latitude in degrees"),
        longitude: z.number().min(-180).max(180).describe("Longitude in degrees"),
        radiusMeters: z.number().int().min(1).max(100_000).default(1_000),
        limit: z.number().int().min(1).max(100).default(10),
        language: z.enum(["de", "en", "fr"]).default("fr"),
      },
    },
    async (options) => {
      const result = await getClient().findNearbyStops(options);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    "search_stops",
    {
      title: "Search stops by name",
      description:
        "Find Luxembourg public transport stops by name, e.g. 'Gare de Luxembourg' or 'Belval Université'. Use the returned stop id with get_departures.",
      inputSchema: {
        query: z.string().trim().min(2).max(100).describe("Stop or place name"),
        limit: z.number().int().min(1).max(50).default(5),
        language: z.enum(["de", "en", "fr"]).default("fr"),
      },
    },
    async (options) => {
      const result = await getClient().searchStops(options);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    "get_departures",
    {
      title: "Get departures from a stop",
      description:
        "Get scheduled and real-time public transport departures for a Mobiliteit.lu stop id. Use the id returned by find_nearby_stops.",
      inputSchema: {
        stopId: z.string().trim().min(1).max(MAX_STOP_ID_LENGTH),
        date: z
          .iso.date()
          .optional()
          .describe("Local travel date in YYYY-MM-DD format"),
        time: z
          .string()
          .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
          .optional()
          .describe("Local 24-hour time in HH:mm or HH:mm:ss format"),
        durationMinutes: z.number().int().min(0).max(1439).default(60),
        limit: z.number().int().min(1).max(100).default(20),
        language: z.enum(["de", "en", "fr"]).default("fr"),
      },
    },
    async (options) => {
      const result = await getClient().getDepartures(options);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );
}

export function createMcpServer({ client, streams }: ServerDependencies): {
  server: McpServer;
  cleanup: () => void;
} {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { resources: { subscribe: true } } },
  );
  // Keyed by resource URI; MCP subscriptions are idempotent, so one
  // unsubscribe cancels however many times the URI was subscribed.
  const subscriptions = new Map<string, () => void>();

  registerTools(server, () => client);

  server.registerResource(
    "stop_departures",
    new ResourceTemplate(RESOURCE_URI_TEMPLATE, { list: undefined }),
    {
      title: "Live stop departures",
      description:
        "Current real-time departures for a stop. Subscribe to receive resource-updated notifications while the feed is active.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const stopId = decodeStopId(String(variables.stopId ?? ""));
      const snapshot = await streams.read(stopId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(snapshot),
          },
        ],
      };
    },
  );

  server.server.setRequestHandler(
    SubscribeRequestSchema,
    async ({ params }) => {
      const stopId = stopIdFromResourceUri(params.uri);
      if (!subscriptions.has(params.uri)) {
        let release: () => void;
        try {
          release = streams.subscribe(stopId, () =>
            server.server.sendResourceUpdated({ uri: params.uri }),
          );
        } catch (error) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            error instanceof Error ? error.message : String(error),
          );
        }
        subscriptions.set(params.uri, release);
      }
      return {};
    },
  );

  server.server.setRequestHandler(
    UnsubscribeRequestSchema,
    async ({ params }) => {
      subscriptions.get(params.uri)?.();
      subscriptions.delete(params.uri);
      return {};
    },
  );

  return {
    server,
    cleanup: () => {
      for (const release of subscriptions.values()) {
        release();
      }
      subscriptions.clear();
    },
  };
}

function validateStopId(value: string): string {
  const stopId = value.trim();
  if (stopId.length === 0 || stopId.length > MAX_STOP_ID_LENGTH) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid stop id");
  }
  return stopId;
}

function stopIdFromResourceUri(value: string): string {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Invalid departure resource URI",
    );
  }
  if (
    uri.protocol !== "mobiliteit:" ||
    uri.hostname !== "stops" ||
    uri.search ||
    uri.hash ||
    !uri.pathname.endsWith("/departures")
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Invalid departure resource URI",
    );
  }

  const encodedStopId = uri.pathname.slice(1, -"/departures".length);
  return decodeStopId(encodedStopId);
}

function decodeStopId(value: string): string {
  try {
    return validateStopId(decodeURIComponent(value));
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(ErrorCode.InvalidParams, "Invalid stop id encoding");
  }
}

export { RESOURCE_URI_TEMPLATE };
