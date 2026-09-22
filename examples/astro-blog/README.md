# kansoCMS + Astro blog

A small Astro 5 static site that reads the kansoCMS JSON API at build time. It uses
plain `fetch`, hand-written types and CSS, with no adapter or `@kanso/*` dependency.
You can copy this folder out of the monorepo.

## Prerequisites

- Node.js 24 and pnpm 10.
- A running kansoCMS reachable from your development machine and build environment.
- A post type such as `blog`, with published posts whose publication dates have passed.
- A **read** API key: create one in the admin API-key screen, or send
  `POST /api/v1/api-keys` with `{ "name": "Astro blog", "scope": "read" }` using an
  admin session and an `Origin` header matching the CMS. Copy the returned `key`;
  it is shown only once. Requests use the `x-api-key` header.

## Setup

From this folder:

```sh
cp .env.example .env
```

Fill in the four values:

| Variable | Value |
| --- | --- |
| `KANSO_API_URL` | CMS origin, e.g. `http://localhost:5199` (without `/api/v1`) |
| `KANSO_API_KEY` | Your read API key; keep it private |
| `KANSO_POST_TYPE` | Post-type slug; defaults to `blog` |
| `PUBLIC_SITE_TITLE` | Displayed site title; defaults to `kansoCMS blog` |

Run `pnpm install` at the **repository root**, or in this folder if you copied it
into a standalone project. For a standalone copy, also ignore `.env`, `.astro/`,
`node_modules/` and `dist/` in your own `.gitignore`.

Then, from this folder:

```sh
pnpm dev        # http://localhost:4321
pnpm build      # generates dist/; the CMS must be reachable
pnpm preview    # serves the generated site
pnpm typecheck  # astro check; no CMS or API key needed
```

From the monorepo root, use `pnpm --filter @kanso/example-astro-blog dev` (or
`build` / `preview`). Root `pnpm dev` starts only the CMS apps; root `pnpm build`
does not build this example. Root typecheck includes `astro check`.

## Generated site

- `/`: all live posts of the configured type, newest first, with date, excerpt
  (falling back to body text) and cover thumbnail.
- `/<type>/<slug>/`: each live post, with cover, categories, tags and body HTML.
- `/<page-path>/`: each live fixed page, including nested paths. A page with path
  `home` renders at `/home/`; the root remains the post list.
- `/404.html`: the not-found page. Configure your static host to use it for misses.

Navigation includes live top-level pages. Both posts and pages follow API pagination
and exclude drafts, missing publication dates and future publication dates. Media
links and images point to the CMS origin; uploaded files remain hosted by kansoCMS.
The API key is read by server-only `astro:env` code and is not shipped to visitors.

## Limitations and deployment

- Embedded forms become a note asking readers to open the original site to submit.
- Search is not included.
- Content changes and scheduled publication require a rebuild. Arrange a scheduled
  build or trigger one after editing content; the generated site does not poll the API.
- Site settings are not fetched because that endpoint needs an admin session.
- This example does not reproduce the CMS theme, redirects, feeds or SEO metadata.

Deploy `dist/` to any static host. Supply the environment variables in the build
environment and keep the CMS and its media URLs publicly reachable. On Cloudflare,
use Pages or `wrangler deploy` with a Static Assets `assets` directory pointing at
`./dist`. No Astro adapter is needed.

Inside the monorepo, `hc<ApiType>` with `ApiType` from `apps/server` could replace
the hand-written API types.
