# Source distribution and shared-service readiness

There are two different things to distribute:

1. **The open-source MCP program.** Host its source, releases, and issue
   tracker on GitHub. Publish versioned npm releases or container images if
   useful. Each organization can run an instance with its own authorized API
   key.
2. **A central hosted MCP endpoint.** Run the service on a VPS or container
   platform and give clients its remote MCP URL. This consumes the operator's
   upstream API access and quota; it is not provided by GitHub.

## Recommended rollout

### Phase 1: publish source and support self-hosting

- Create a public GitHub repository and publish tagged releases.
- Keep the Apache-2.0 source license distinct from upstream-data terms.
- Provide a Docker image and the local stdio install path.
- Ask each deployer to obtain and configure its own approved API access.
- Keep API secrets out of source, examples, logs, and issue reports.

This route lets a government unit, startup, or institution operate under its
own access agreement, infrastructure requirements, and request quota.

### Phase 2: invite-only shared pilot

Use the [VPS deployment guide](./hosting.md) for one deployment under your
control. Give the single shared bearer token only to a small, trusted pilot
group using an approved secret-sharing method. Monitor usage and upstream
quotas, set an explicit stop-feed cap, and rotate the token if it is exposed.

The shared bearer token is a temporary pilot gate, not individual identity:
you cannot revoke just one user, attribute requests to a user, or set a
per-user quota. Do not call this an unrestricted public service.

### Phase 3: public or multi-organization service

Before onboarding arbitrary users, implement and test:

- MCP-compatible OAuth 2.1 authorization for Streamable HTTP, including
  Protected Resource Metadata and authorization-server discovery.
- User and organization onboarding, token revocation, and appropriate scopes.
- Per-user and global rate limits, request budgets, and concurrency limits.
- Usage accounting and alerts before upstream quotas are exhausted.
- Terms of use, privacy notice, data-source attribution, incident contact,
  support process, and retention policy.
- A provider-approved API arrangement that explicitly permits the intended
  number of users, commercial use, hosted redistribution, and cached or
  streamed responses.
- Operational readiness: TLS, patching, backups, monitoring, incident
  response, recovery objectives, and an availability plan.

Use the [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization)
as the interoperability baseline for HTTP authorization, rather than treating
a reverse-proxy password or shared static bearer token as user login.

The current server does not implement OAuth, per-user accounts, persistent
sessions, distributed feed sharing, per-user rate limits, or an
administrator/user interface. Avoid horizontal replicas until session
affinity and shared subscription state are designed and tested.

## Hosting choices

For this repository as it stands, a small Linux VPS running Docker Compose
behind Caddy is the most direct deployment: the [hosting guide](./hosting.md)
contains the exact steps. It is portable between providers and lets you choose
a region and procurement arrangement suitable for your organization.

A managed container platform can also run the Docker image. Before choosing
one, confirm that it supports long-lived Streamable HTTP/SSE connections,
does not scale the service to zero while clients are subscribed, preserves
the session's routing to the same process, supports mounted secrets, and meets
data-location requirements. This version keeps sessions and feeds in process
memory, so it is not a drop-in horizontally scalable service.

## GitHub is not the runtime host

GitHub is appropriate for the source repository, issue tracker, releases,
CI, and optionally GHCR image distribution. A VPS or container service runs
the MCP endpoint. Publishing code or an image does not publish the API key
or create an operating service.
