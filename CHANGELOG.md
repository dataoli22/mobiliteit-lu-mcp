# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
