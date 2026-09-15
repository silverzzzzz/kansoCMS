# kansoCMS

A minimal, WordPress-shaped CMS that runs entirely on Cloudflare (Workers + D1 + R2).

- Fixed pages (hierarchical) and posts grouped into post types (`blog`, `news`, …) with categories and tags
- Server-rendered HTML with JSON-LD, Open Graph, `sitemap.xml`, `robots.txt` and an Atom feed per post type — no client JS
- The same content over a headless JSON API (`/api/v1`, API-key auth) for Astro / Next / anything else
- Admin UI with a Tiptap editor, media library (R2) and draft preview
- One `wrangler deploy`, no servers, no Node runtime in production

Design notes live in [docs/architecture.md](docs/architecture.md) and the per-task decisions in
[docs/tasks/phase-1.md](docs/tasks/phase-1.md) (both Japanese).

> Status: **Phase 2 complete** — blog + fixed pages, contact forms (builder, embedded `<form>`, email notifications) work from the admin UI.
> Revisions, redirects and search (Phase 3) are not built yet.

## Layout

```
apps/
  server/   Hono Worker: public SSR site, /api/v1, /media (R2), /admin (static SPA), /preview
  admin/    React + Vite admin UI, built into apps/server/public/admin
packages/
  shared/   zod schemas & constants shared by server and admin
  core/     Drizzle schema, migrations, content pipeline and services (framework-agnostic)
  seo/      JSON-LD builders, <head> metadata, sitemap and Atom helpers (pure functions)
docs/       architecture, task board and decisions
```

## Requirements

- Node.js 22+
- pnpm 10 (`corepack enable`)
- A Cloudflare account only when you deploy — local dev runs on `workerd` with emulated D1/R2

## Local development

```sh
pnpm install
pnpm db:migrate:local     # apply packages/core/migrations to the local D1
pnpm dev                  # server on http://localhost:5173, admin dev server on :5174
```

- `http://localhost:5173/` — public site (SSR)
- `http://localhost:5173/api/v1/health` — API
- `http://localhost:5174/admin/` — admin UI with hot reload (proxies `/api` and `/media` to :5173)

On first run open `/admin/setup` to create the admin user, then log in at `/admin/login`.

To see the built admin served by the Worker itself, run `pnpm build` once; it lands in `apps/server/public/admin/` and is served at `http://localhost:5173/admin/`.

If port 5173 is taken, start the server alone with a different port:
`pnpm --filter @kanso/server exec vite dev --port 5199`.

### Form notifications (email)

Manage forms under **管理画面 → フォーム**. Each form has its own field definitions and a
submission inbox, and submissions can be downloaded as CSV. To enable Turnstile, save the site
key under **設定 → フォーム** and configure the Worker secret with
`pnpm --filter @kanso/server exec wrangler secret put TURNSTILE_SECRET_KEY`.
Insert a **フォーム** block from the editor toolbar to render a public form that works without JavaScript.

Notifications are sent only when **Settings → Forms** has a `fromEmail` and either the form
or the Forms settings has at least one recipient. In local development the `EMAIL` binding is
emulated: nothing is delivered, the dev server prints
`send_email binding called with MessageBuilder:`, and the text and HTML bodies are written to
files under `.wrangler/`.

To send real email from `wrangler dev`, temporarily add `"remote": true` to the `send_email`
binding. Real mail will go out; remove that option before committing. In production, onboard the
`fromEmail` domain first:

```sh
pnpm --filter @kanso/server exec wrangler email sending enable <domain>
```

A failed send never fails the form submission. Search the Worker logs for
`form_notify_failed` to diagnose notification failures.

## What the public site serves

Public-facing strings (404, form labels and validation messages) follow the site `locale` setting — Japanese for `ja`, English otherwise.

| URL | Content |
| --- | --- |
| `/` | The page whose path is `home`; otherwise the archive of the post type set as *home* in settings; otherwise a placeholder |
| `/company`, `/company/team` | Fixed pages, resolved by their full `path` |
| `/blog` | Post-type archive, 10 per page, `?page=2` … (`page=1` and invalid values redirect to the bare URL) |
| `/blog/hello-world` | A post: `BlogPosting` + `BreadcrumbList` JSON-LD, `og:type=article`, `rel=alternate` to the feed |
| `/blog/category/news`, `/blog/tag/cloudflare` | Filtered archives |
| `/blog/feed.xml` | Atom feed of the 20 latest posts |
| `/sitemap.xml`, `/robots.txt` | Home, indexable published pages, every post type and indexable published posts |
| `/preview/page/:id`, `/preview/post/:id` | Draft preview — admin session only, `noindex`, never cached |
| `/media/…` | Uploaded files from R2, `immutable` |

Top-level slugs are shared between pages and post types, so a `blog` page and a `blog` post type cannot coexist. Every page carries `WebSite` (and `Organization` once you fill in the organisation settings), `WebPage` / `CollectionPage`, canonical, OG and `rel=prev/next` metadata.

Public HTML is cached in the Workers Cache API for 60 s (`x-kanso-cache: HIT|MISS`). Every content write through the admin API rotates a site-wide cache generation, so changes show up immediately in every data centre; requests carrying an admin session bypass the cache.

## Using the API

Every `/api/v1` route except `health`, `setup` and `auth/login` requires either the admin session cookie or an API key in `x-api-key`. Keys are created in the admin UI (or `POST /api/v1/api-keys`) with a `read` or `write` scope; `write` is required for `POST`/`PATCH`/`PUT`/`DELETE`.

```sh
# with a session (mutations also need an Origin header matching the site)
curl -c cookies.txt -H "content-type: application/json" \
  -d '{"email":"admin@example.com","password":"password123"}' \
  http://localhost:5173/api/v1/auth/login
curl -b cookies.txt -H "origin: http://localhost:5173" -H "content-type: application/json" \
  -d '{"title":"About","slug":"about","status":"published"}' \
  http://localhost:5173/api/v1/pages

# headless read with an API key
curl -H "x-api-key: kanso_…" "http://localhost:5173/api/v1/posts?type=blog&status=published"
```

Upload media with `curl -b cookies.txt -H "origin: http://localhost:5173" -F file=@photo.png -F alt="Photo" http://localhost:5173/api/v1/media`.

Post bodies are ProseMirror JSON (`bodyJson`); the server validates them, renders `bodyHtml`, and derives an effective excerpt at render time when no explicit excerpt is stored. The admin UI is a plain client of this API — `hc<ApiType>` from `apps/server` gives it end-to-end types.

## Deploy

```sh
cd apps/server
pnpm exec wrangler d1 create kanso          # copy database_id into wrangler.jsonc
pnpm exec wrangler r2 bucket create kanso-media
cd ../..
pnpm db:migrate                             # apply migrations to the remote D1
pnpm deploy
```

Set `SITE_URL` in `apps/server/wrangler.jsonc` to your production origin; it is used for canonical URLs, JSON-LD, the sitemap and feeds.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run server and admin dev servers in parallel |
| `pnpm build` | Build admin, then the Worker (`apps/server/dist`) |
| `pnpm deploy` | Build and `wrangler deploy` |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest in every package that has tests |
| `pnpm check` / `pnpm format` | Biome lint + format |
| `pnpm types` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `pnpm db:generate` | Generate a SQL migration from the Drizzle schema |
| `pnpm db:migrate:local` / `pnpm db:migrate` | Apply migrations to local / remote D1 |

## License

MIT
