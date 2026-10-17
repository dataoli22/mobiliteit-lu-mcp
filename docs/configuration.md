# Configuration reference

All settings are environment variables. The server does not load `.env` itself;
Docker Compose reads its local `.env` file for interpolation, and the hosting
guide mounts API and HTTP tokens from files.

| Setting | Default | Meaning |
| --- | --- | --- |
| `MOBILITEIT_API_KEY` | Required | Authorized upstream API key. Prefer `MOBILITEIT_API_KEY_FILE` for a mounted secret. |
| `MOBILITEIT_API_KEY_FILE` | Unset | Path to a file containing the upstream API key. Set this **or**, not both, `MOBILITEIT_API_KEY`. |
| `MCP_TRANSPORT` | `stdio` | `stdio`, `http`, or `both`. |
| `MCP_HTTP_BEARER_TOKEN` | Required for HTTP | Shared HTTP bearer token. Prefer `MCP_HTTP_BEARER_TOKEN_FILE` for a mounted secret. |
| `MCP_HTTP_BEARER_TOKEN_FILE` | Unset | Path to a file containing the HTTP bearer token. Set this **or**, not both, `MCP_HTTP_BEARER_TOKEN`. |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address. Use `0.0.0.0` only inside a suitably firewalled container/reverse-proxy deployment. |
| `MCP_HTTP_PORT` | `3000` | HTTP listener port. |
| `MCP_HTTP_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Comma-separated hostnames accepted in the HTTP `Host` header for `/mcp`. Configure the public MCP hostname behind a reverse proxy. `/healthz` is answered for any host. |
| `MOBILITEIT_POLL_INTERVAL_SECONDS` | `30` | Snapshot polling cadence for subscribed stops; minimum `15`. |
| `MOBILITEIT_MAX_ACTIVE_FEEDS` | `1` | Maximum distinct subscribed stop feeds at once; positive integer. Each feed issues one upstream request per poll. |
| `MOBILITEIT_MAX_REQUESTS_PER_MINUTE` | `60` | Rolling one-minute cap on all upstream requests (tools, resource reads and polling combined). Requests over the cap fail immediately instead of reaching the API. |
| `MCP_HTTP_SESSION_IDLE_TIMEOUT_SECONDS` | `1800` | Close an HTTP session, and release its subscriptions, once it has had no open request or stream for this long. Protects feed slots from clients that disconnect without ending their session. |
| `MCP_HTTP_MAX_SESSIONS` | `100` | Maximum concurrent HTTP sessions. New sessions beyond this receive `503`. |

Numeric settings must be whole numbers; an empty value is rejected rather than
treated as zero.

HTTP mode requires TLS termination at a trusted reverse proxy for anything
outside localhost. The built-in bearer-token check is a shared-secret pilot
mechanism, not MCP OAuth or per-user identity.
