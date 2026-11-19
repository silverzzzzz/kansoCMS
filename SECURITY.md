# Security policy

This policy covers kansoCMS itself. Sites created with `create-kanso` contain a copy of this
file: report problems in kansoCMS code upstream as described here, and problems in a particular
site to that site's owner.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting:
[open a report](https://github.com/silverzzzzz/kansoCMS/security/advisories/new). Do not open a
public issue, pull request or discussion for a vulnerability.

Describe what is affected, how to reproduce it (a proof of concept helps) and what an attacker
gains. Please do not test against sites you do not own; a local install (`pnpm dev`) runs the
same code.

## Supported versions

kansoCMS has no releases. Only the latest commit on `main` is supported, and fixes land there.
A site created with `create-kanso` is a copy, so its owner brings a fix into the site and deploys
again.

## Scope

In scope:

- The Worker (`apps/server` and the packages it uses: `packages/core`, `packages/shared`,
  `packages/seo`): the public site, `/api/v1`, `/media`, previews, setup and passkey sign-in.
- The admin SPA (`apps/admin`).
- `create-kanso` (`packages/create-kanso`).

Out of scope:

- The configuration of a site's own Cloudflare account: DNS, routes, secrets, access to the
  account and similar settings.
- The Cloudflare platform itself (Workers, D1, R2, Workers AI and so on). Report those to
  Cloudflare: <https://www.cloudflare.com/disclosure/>.
- Vulnerabilities in third-party dependencies, unless kansoCMS uses the dependency in a way that
  makes it exploitable. Report the rest to the dependency's maintainers.

## Response

Reports are handled on a best-effort basis: there is no bug bounty and no guaranteed response
time. Replies come in the report thread. Once a fix is on `main`, the advisory is published and
credits the reporter unless they prefer otherwise.
