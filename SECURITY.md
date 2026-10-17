# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
open the repository's **Security** tab and choose **Report a vulnerability**.
Include the affected version, steps to reproduce, and the impact you expect.

You should receive an acknowledgement within a week. Fixes are released as a
new version, and the advisory is published once a fix is available.

## Never include secrets in reports

Do not put a Mobiliteit.lu/HAFAS API key, an MCP bearer token, or the contents
of a `secrets/` directory in an issue, pull request, log excerpt, or report.
If you have exposed one, revoke or rotate it first: request a new API key from
the data provider, and generate a new bearer token as described in
[docs/hosting.md](./docs/hosting.md).

## Scope

In scope: this repository's server code, Dockerfile, and Compose/Caddy
configuration.

Out of scope: the upstream mobiliteit.lu/HAFAS API and its availability, and
weaknesses that are documented limitations of the pilot design (one shared
bearer token, no OAuth or per-user identity, in-memory sessions). See
[docs/distribution.md](./docs/distribution.md).

## Supported versions

Only the latest released version receives security fixes.
