# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0]

### Added

- `search_stops` tool: find stops by name through HAFAS `location.name`.
- Stateless Vercel endpoint (`api/mcp.ts`, `vercel.json`) serving the lookup
  tools with bearer-token auth. It refuses requests until a token is set.

### Changed

- Renamed `src/server.ts` to `src/mcp-server.ts`, because Vercel treats
  `src/server.ts` as a server entry point.

### Fixed

- `get_departures` and departure feeds sent `rtMode=FULL`, which the
  departureBoard API does not accept; they now send `SERVER_DEFAULT`, the
  documented mode that includes real-time data.
- An API key longer than the documented 128-character limit is now rejected
  at startup.

## [0.1.0]

Initial public release.

- `find_nearby_stops` and `get_departures` tools backed by the mobiliteit.lu
  HAFAS API.
- `mobiliteit://stops/{stopId}/departures` resource with change notifications
  for subscribed stops, using shared, capped upstream polling.
- MCP stdio and Streamable HTTP transports; HTTP uses a shared bearer token,
  a Host allowlist, idle-session expiry, and a concurrent-session cap.
- Rolling per-minute cap on all upstream API requests.
- Docker image and a Docker Compose + Caddy deployment for a trusted pilot.
