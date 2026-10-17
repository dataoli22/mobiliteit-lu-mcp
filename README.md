# Mobiliteit.lu MCP

An open-source [Model Context Protocol](https://modelcontextprotocol.io/)
server for Luxembourg public-transport data from the Mobiliteit.lu HAFAS API.
It provides nearby-stop lookup, departures, and change notifications for
subscribed stops.

The upstream API exposes real-time data as HTTP request/response snapshots.
This server polls those snapshots and notifies MCP subscribers when departure
data changes; this is near-real-time polling, not an upstream push feed.

> **Unofficial project.** This server is an independent community project. It
> is not affiliated with, endorsed by, or operated by mobiliteit.lu, the
> Luxembourg Ministry of Mobility and Public Works, the Administration des
> transports publics, or HaCon/HAFAS.

## Get an API key

**You need your own API key before the server can return any data.** This
server does not contain transport data. It forwards each request to the
mobiliteit.lu HAFAS open-data API at `https://cdt.hafas.de/opendata/apiserver/`,
which rejects requests without a valid key (`HTTP 401`). No key is
included with this project; each deployment should use its own.

Keys are issued by the Administration des transports publics (ATP) on request:

1. Email **opendata-api@atp.etat.lu** and ask for an API key (`accessId`) for
   the mobiliteit.lu open-data API. Say briefly what you are building and
   roughly how many requests you expect; see [Quotas](#quotas) below.
2. Wait for the ATP to reply with your key, its request quota, and the usage
   terms. Check that those terms allow what you plan to do, especially if you
   will host the server for other people.
3. Store the key outside the repository and give it to the server, either in a
   file referenced by `MOBILITEIT_API_KEY_FILE` (preferred) or in the
   `MOBILITEIT_API_KEY` environment variable. See
   [configuration](./docs/configuration.md) and [client setup](./docs/clients.md).

Never commit the key, paste it into prompts or chat, or include it in issue
reports. `.env.example` documents the supported settings but is not loaded
automatically. Open-sourcing this server does not grant API access or rights
to redistribute the provider's data. The ATP publishes the data under
[CC BY 4.0](https://data.public.lu/en/datasets/api-mobiliteit-lu); credit the
ATP as the data source in anything you build on it.

## Quotas

Each unique active stop feed is shared by its subscribers and polled once per
interval. Defaults are a 30-second interval and one active stop feed. One
continuously active feed at that interval makes about 2,880 upstream requests
per day, before ordinary lookups and retries. Increase
`MOBILITEIT_MAX_ACTIVE_FEEDS` only after confirming the quota issued for your
API key. All upstream calls (tool calls, resource reads and polling) also share
a rolling cap, `MOBILITEIT_MAX_REQUESTS_PER_MINUTE` (default 60), so one client
cannot exhaust the key's quota. Failed upstream requests are logged to stderr;
existing clients are not given fabricated or silently substituted results.

## Transports and clients

Requires Node.js 22 or newer.

```sh
npm install
npm test
npm run typecheck
npm run build
```

For a hosted endpoint, see the step-by-step
[VPS deployment guide](./docs/hosting.md), or the
[serverless Vercel option](./docs/hosting.md#serverless-option-vercel) for a
tools-only endpoint without live subscriptions. It deploys the app with Docker
Compose and Caddy-managed HTTPS. This is the recommended route for a trusted
pilot; the current HTTP authentication is one shared bearer token, not
per-user OAuth.

The default transport for a local installation is MCP over stdio:

```sh
node dist/src/index.js
```

`MCP_TRANSPORT` supports `stdio`, `http`, or `both`. HTTP listens on
`127.0.0.1:3000` by default at `/mcp`; it requires
`MCP_HTTP_BEARER_TOKEN` or `MCP_HTTP_BEARER_TOKEN_FILE`. Do not expose the
service directly to the public internet without HTTPS and suitable
authentication.

Cursor and Claude Desktop can launch the stdio server. Streamable HTTP enables
remote clients where their MCP implementation supports it. Ollama support
depends on the MCP host used with the model.

## MCP tools and resources

- `find_nearby_stops`: look up stops by WGS84 coordinates.
- `get_departures`: request departures for a stop, including real-time data
  where supplied by the API.
- `mobiliteit://stops/{stopId}/departures`: a resource clients can read and
  subscribe to. The server sends standard MCP resource-update notifications
  when a polled snapshot changes; clients can then read the resource again.

The polling interval can be configured with
`MOBILITEIT_POLL_INTERVAL_SECONDS` (minimum 15 seconds). The maximum number of
distinct simultaneously active feeds is configured with
`MOBILITEIT_MAX_ACTIVE_FEEDS`.

## Security

See [SECURITY.md](./SECURITY.md) for how to report a vulnerability privately.

## License

The server source code is licensed under [Apache-2.0](./LICENSE). This license
does not apply to the upstream transport data, the HAFAS API, or their
trademarks and usage terms.

## More documentation

- [Hosting and deployment](./docs/hosting.md)
- [Distribution and public-service readiness](./docs/distribution.md)
- [Configuration reference](./docs/configuration.md)
- [MCP client setup](./docs/clients.md)
