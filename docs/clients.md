# Connect MCP clients

The server supports local MCP stdio and remote MCP Streamable HTTP. Client
configuration varies by product/version; use that client's current MCP
settings UI or documentation.

## Local stdio

Build the project:

```sh
npm ci
npm run build
```

Configure the client to launch `node` with the absolute path to
`dist/src/index.js` as its argument and `MOBILITEIT_API_KEY` in the process
environment. For example, a generic MCP configuration can look like:

```json
{
  "mcpServers": {
    "mobiliteit": {
      "command": "node",
      "args": ["C:/path/to/mobiliteit-lu-mcp/dist/src/index.js"],
      "env": {
        "MOBILITEIT_API_KEY": "YOUR_LOCAL_API_KEY"
      }
    }
  }
}
```

Only use a local configuration file protected by the operating system account.
Do not commit a configuration containing an API key. You can instead launch
the client from an environment where `MOBILITEIT_API_KEY` is already set.

## Remote Streamable HTTP

For a hosted deployment, add an MCP server using the endpoint
`https://mcp.example.org/mcp` and the bearer token supplied by the operator.
The client must support Streamable HTTP and custom bearer authorization
headers. MCP hosts that only support OAuth login may not connect to this
version until OAuth is implemented.

The current hosted token is shared by all pilot users. Do not paste it into
prompts or share it in public channels. Ask the operator to rotate it if it
leaks.

## Verify and use

The server provides:

- `find_nearby_stops` to get stop IDs from latitude and longitude.
- `get_departures` for a one-time departures query.
- The resource URI `mobiliteit://stops/{stopId}/departures` for reading and,
  in supporting clients, subscribing to departure changes.

Subscribing starts upstream polling for that stop. When the snapshot changes,
the server sends a resource-updated notification; the MCP client should read
the resource again to get the new snapshot. If a poll fails after a snapshot
has been received, the resource marks that snapshot `stale` and includes the
poll error rather than presenting it as current.
