# Host a Mobiliteit.lu MCP pilot

This guide runs the MCP server on a Linux VPS behind Caddy. Caddy obtains and
renews a publicly trusted HTTPS certificate. Docker Compose keeps the app and
reverse proxy together, and the app's port is not published directly to the
internet.

## Before you start

You need:

- A Linux VPS with Docker Engine and the Docker Compose plugin installed.
- A domain or subdomain that you control, for example
  `mcp.example.org`.
- DNS access to point that name at the VPS public IP address.
- TCP ports 80 and 443 open in the provider firewall and the VPS firewall.
- An authorized Mobiliteit/HAFAS API key, with permission and quota adequate
  for your intended use.
- A strong random token to give to each trusted pilot user. This release uses
  one shared bearer token for the hosted instance.

If the domain already serves a website, leave it where it is: add a subdomain
such as `mcp.example.org` and point only that DNS record at the VPS. The
website and MCP endpoint can then be deployed and maintained independently.

Choose an infrastructure provider and hosting region that satisfy your
organization's procurement, data-residency, availability, and support
requirements. This deployment is portable across ordinary Linux VPS providers;
GitHub is only the place to publish source/releases, not where this service
runs.

## 1. Prepare the server and DNS

Install Docker Engine and the Compose plugin using the official instructions
for your Linux distribution. Create an A record for your chosen MCP hostname
pointing at the VPS's public IPv4 address. Add an AAAA record only if the VPS
has working public IPv6 connectivity. Wait for DNS to resolve before starting
Caddy.

Allow inbound TCP ports 80 and 443. Port 80 is used for certificate
validation and HTTP-to-HTTPS redirects; MCP clients connect over 443. Do not
open port 3000: Compose exposes that port only to the internal container
network.

## 2. Fetch the source

SSH into the VPS and run:

```sh
git clone https://github.com/dataoli22/mobiliteit-lu-mcp.git
cd mobiliteit-lu-mcp
```

For updates, use `git pull` after checking release notes.

## 3. Configure hostname and polling

Create the private Compose environment file from the documented template:

```sh
cp .env.example .env
```

Edit `.env` and set the hostname you configured in DNS. For example:

```dotenv
MCP_DOMAIN=mcp.example.org
MCP_HTTP_ALLOWED_HOSTS=localhost,127.0.0.1,mcp.example.org
MOBILITEIT_POLL_INTERVAL_SECONDS=30
MOBILITEIT_MAX_ACTIVE_FEEDS=1
```

Keep `MOBILITEIT_MAX_ACTIVE_FEEDS` low until you have confirmed the API quota.
At a 30-second interval, each continuously subscribed stop uses about 2,880
upstream requests per day, in addition to on-demand tool calls.

## 4. Install secrets without committing them

Compose mounts the two secret files read-only into the app container. The
repository ignores the `secrets/` directory.

```sh
install -d -m 700 secrets
umask 077
openssl rand -hex 32 > secrets/mcp_http_bearer_token
read -rsp "Mobiliteit API key: " MOBILITEIT_API_KEY
printf '\n'
printf '%s' "$MOBILITEIT_API_KEY" > secrets/mobiliteit_api_key
unset MOBILITEIT_API_KEY
chmod 600 secrets/mobiliteit_api_key secrets/mcp_http_bearer_token
sudo chown 1000:1000 secrets/mobiliteit_api_key secrets/mcp_http_bearer_token
```

The API key is entered silently and written to a file readable only by the
deploying account and the container's unprivileged `node` user (UID 1000).
Compose file-backed secrets are mounted from the host; they are not encrypted
secret storage. Protect the VPS and backups accordingly. Send the bearer-token
file contents to pilot users through an approved secret-sharing channel. Do not
put either value in GitHub, chat, terminal command arguments, or support
tickets.

## 5. Start the service

Validate the Compose configuration, then build and start both containers:

```sh
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 mcp caddy
```

Check the public health endpoint:

```sh
curl --fail https://mcp.example.org/healthz
```

It should return `{"status":"ok"}`. Check that an unauthenticated MCP request
is rejected:

```sh
curl -i https://mcp.example.org/mcp
```

The MCP endpoint should respond with `401 Unauthorized` and a bearer challenge.
The health endpoint is a liveness check only; it does not verify the upstream
API key or quota. Use an authenticated MCP client to test tools and
subscriptions.

## 6. Give pilot users the connection details

Share these with each trusted pilot user:

- Server URL: `https://mcp.example.org/mcp`
- Transport: MCP Streamable HTTP
- Authorization: bearer token, supplied separately
- Tools: `find_nearby_stops` and `get_departures`
- Live updates: subscribe to the `mobiliteit://stops/{stopId}/departures`
  resource if their MCP client supports resource subscriptions

Some clients implement remote MCP authorization but do not let users supply a
manually issued bearer token. Check that the chosen client supports a custom
authorization header before onboarding users. This server does not yet
implement MCP OAuth authorization discovery or OAuth login.

## 7. Update and operate

To update after publishing a new revision:

```sh
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 mcp caddy
```

To stop:

```sh
docker compose down
```

To remove the containers and Caddy certificate storage as well:

```sh
docker compose down --volumes
```

The latter removes Caddy's stored TLS certificates and configuration; it does
not delete the source or secret files.

Monitor `docker compose logs -f mcp caddy`, VPS disk and memory, API quota
usage, certificate renewal, and the provider's service availability. Protect
the VPS with security updates, SSH keys, a firewall, least-privilege accounts,
and backups of any operational data you choose to store.

The stop-search tool sends the supplied coordinates to the upstream transport
API. Before serving users, document this data flow and check that it meets your
privacy notice, retention, and data-protection requirements. The application
does not persist stop searches, but hosting-provider and system logs still
need an appropriate retention policy.

## What this deployment is not

This is suitable for a small, trusted pilot. It has one shared bearer token,
in-memory MCP sessions, and in-memory polling subscriptions. Anyone holding
the bearer token shares the same access and upstream API quota. The service
should run as one app instance: adding replicas behind a load balancer would
require session affinity and shared feed/session management, neither of which
is implemented.

Do not publish the bearer token on a public web page or make an unrestricted
endpoint available to anonymous clients. Before operating a broadly shared
service, add OAuth 2.1 authorization compatible with MCP, user onboarding and
revocation, per-user rate limits and usage accounting, monitoring/alerting,
and a quota policy. See
[distribution and public-service readiness](./distribution.md).

An alternative is to publish the source on GitHub and the container image in
GitHub Container Registry (GHCR), then run that image on an approved VPS or
container platform. GHCR distributes the image; it does not run the service.

## Serverless option: Vercel

The repository also contains a stateless endpoint for Vercel at
`api/mcp.ts`. Import the GitHub repository as a Vercel project; `vercel.json`
configures the build, and the endpoint is served at `https://<project>.vercel.app/mcp`.

Set these environment variables in the Vercel project settings, then redeploy:

| Variable | Required | Meaning |
| --- | --- | --- |
| `MCP_HTTP_BEARER_TOKEN` | Yes | Shared bearer token clients must send. Until it is set, the endpoint answers `503` to every MCP request. |
| `MOBILITEIT_API_KEY` | For data | The ATP-issued key. Without it, tools return a "no API key configured" error. |
| `MOBILITEIT_MAX_REQUESTS_PER_MINUTE` | No | Upstream request cap per running instance (default `60`). |

Serverless differences from the Docker deployment:

- Only the tools `find_nearby_stops` and `get_departures` are served. The
  live departure resource and its subscriptions need a long-running process,
  so use the Docker deployment if you need them.
- Requests are stateless (no MCP sessions); `GET` and `DELETE` on `/mcp`
  return `405`.
- The request cap applies per function instance, not globally.

## References

- [Docker Engine installation](https://docs.docker.com/engine/install/)
- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization)
