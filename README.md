# kansoCMS

A minimal, WordPress-shaped CMS that runs entirely on Cloudflare (Workers + D1 + R2).

- Fixed pages (hierarchical) and posts grouped into post types (`blog`, `news`, …) with categories and tags
- Server-rendered HTML with JSON-LD, Open Graph, `sitemap.xml`, `robots.txt` and an Atom feed per post type — no client JS
- The same content over a headless JSON API (`/api/v1`, API-key auth) for Astro / Next / anything else
- Admin UI with a Tiptap editor, media library (R2) and draft preview
- Passwordless sign-in with passkeys (WebAuthn): Windows Hello, Touch ID, a phone or a security key — no passwords stored, no email service needed
- Revision history keeps the latest 20 pre-save states and restores them from the admin UI
- Manual 301/302 redirects plus automatic redirects when published page paths or post slugs change
- Japanese and English full-text search across published pages and posts, with highlighted snippets (D1 FTS5)
- Bundled Default and Paper themes, switchable in site settings
- Shopify-style customize editor: compose pages from theme sections (hero, text, latest posts, …) with a live preview, plus theme-wide settings (accent color, footer, social links) — no code, no Liquid
- A starter site for a small business (sectioned home and services pages, about, contact form, news posts, images) installed at setup by default, and removable later without touching what you edited
- One `wrangler deploy`, no servers, no Node runtime in production

Design notes live in [docs/architecture.md](docs/architecture.md) and the per-task decisions in
[docs/tasks/phase-1.md](docs/tasks/phase-1.md) (both Japanese).

> Status: **Phase 6 complete** — blog + fixed pages, contact forms, full-text search, themes, the
> section-based customize editor, a removable starter site and passkey sign-in all work from the
> admin UI. The admin UI is Japanese only for now.

## Layout

```
apps/
  server/   Hono Worker: public SSR site, /api/v1, /media (R2), /admin (static SPA), /preview
  admin/    React + Vite admin UI, built into apps/server/public/admin
packages/
  create-kanso/  CLI for scaffolding a site from the upstream repository
  shared/   zod schemas & constants shared by server and admin
  core/     Drizzle schema, migrations, content pipeline and services (framework-agnostic)
  seo/      JSON-LD builders, <head> metadata, sitemap and Atom helpers (pure functions)
examples/
  astro-blog/  Astro SSG blog reading the headless API
docs/       architecture, task board and decisions
```

## Requirements

- Node.js 22+
- pnpm 10 (`corepack enable`)
- A Cloudflare account only when you deploy — local dev runs on `workerd` with emulated D1/R2

## Local development

Start a new site with `npm create kanso@latest my-site`, then `cd my-site` and follow the
printed setup steps (requires publishing `create-kanso` first; see
[CLI usage and offline options](packages/create-kanso/README.md)). For an existing checkout:

```sh
pnpm install
pnpm db:migrate:local     # apply packages/core/migrations to the local D1
pnpm dev                  # server on http://localhost:5173, admin dev server on :5174
```

- `http://localhost:5173/` — public site (SSR)
- `http://localhost:5173/api/v1/health` — API
- `http://localhost:5174/admin/` — admin UI with hot reload (proxies `/api` and `/media` to :5173)

On first run open `/admin/setup`: enter the site name and the first admin, then create a passkey
when the browser asks (there are no passwords). Sign in at `/admin/login` with that passkey, and add
passkeys for your other devices under **アカウント**. Passkeys work on `localhost` (any port) and on
HTTPS domains, not on IP addresses such as `127.0.0.1`, and they belong to the domain they were
created on. Setup installs the starter site unless you untick **サンプルサイトを入れる**; remove it (or add it later) under
設定 → サンプルサイト. Removal keeps pages and posts you edited, images still in use, forms with
submissions and post types you added posts to.

#### Lost passkeys

Anyone who can write to the site's D1 database can issue a one-time link (valid for an hour) that
registers a new passkey for an existing user and signs them in:

```sh
pnpm passkey:link you@example.com                                   # local D1, prints http://localhost:5173/…
pnpm passkey:link you@example.com --remote --url https://example.com  # production D1
```

Upgrading from a version with passwords: `pnpm db:migrate` applies `0006_passkeys.sql`, which deletes
the stored password hashes. Sessions that are already signed in keep working, so add a passkey
under **アカウント** before they expire; otherwise use `pnpm passkey:link`.

To see the built admin served by the Worker itself, run `pnpm build` once; it lands in `apps/server/public/admin/` and is served at `http://localhost:5173/admin/`.

If port 5173 is taken, start the server alone with a different port:
`pnpm --filter @kanso/server exec vite dev --port 5199`.

### End-to-end tests

Install Chromium once, then run the Playwright suite:

```sh
pnpm e2e:install
pnpm db:migrate:local
pnpm e2e
```

`pnpm e2e` builds the admin and starts the Worker on port 5199, or reuses a server already
running there. The local D1 must have its migrations applied. The suite signs in as
`admin@example.com` with a test-only software passkey (a fixed key in `e2e/helpers.ts`): if setup
has not run it creates that admin with it, and if the admin exists without it (for example a
database set up by hand) it registers the key through `passkey:link` against the local D1. The
passkey screens are tested with Chromium's virtual authenticator. Test pages and forms use the `e2e-` slug prefix and are deleted after the run. The
starter-site test installs and removes the starter site, and skips itself when the database
already has it installed.

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
| `/old-path` | A managed 301/302 redirect when no published page or post matches the path |
| `/search?q=…` | Published page/post search with highlighted snippets and `?q=…&page=2` pagination; `noindex` |
| `/blog` | Post-type archive, 10 per page, `?page=2` … (`page=1` and invalid values redirect to the bare URL) |
| `/blog/hello-world` | A post: `BlogPosting` + `BreadcrumbList` JSON-LD, `og:type=article`, `rel=alternate` to the feed |
| `/blog/category/news`, `/blog/tag/cloudflare` | Filtered archives |
| `/blog/feed.xml` | Atom feed of the 20 latest posts |
| `/sitemap.xml`, `/robots.txt` | Home, indexable published pages, every post type and indexable published posts |
| `/preview/page/:id`, `/preview/post/:id` | Draft preview — admin session only, `noindex`, never cached |
| `/media/…` | Uploaded files from R2, `immutable` |

Top-level slugs are shared between pages and post types, so a `blog` page and a `blog` post type cannot coexist. Content pages carry `WebSite` (and `Organization` once you fill in the organisation settings), `WebPage` / `CollectionPage`, canonical, OG and `rel=prev/next` metadata. Search pages have no JSON-LD.

Public HTML is cached in the Workers Cache API for 60 s (`x-kanso-cache: HIT|MISS`). Every content write through the admin API rotates a site-wide cache generation, so changes show up immediately in every data centre; requests carrying an admin session bypass the cache.

## Using the API

For a complete headless frontend, see [examples/astro-blog](examples/astro-blog): an Astro 5 static blog that reads the API with a read key at build time. Its README covers setup, local development and static hosting.

Every `/api/v1` route except `health`, `setup` and the passkey sign-in routes (`auth/passkey*`, `auth/passkey-link*`) requires either the admin session cookie or an API key in `x-api-key`. Sessions come from signing in with a passkey in the browser, so scripts use API keys. Keys are created in the admin UI (or `POST /api/v1/api-keys`) with a `read` or `write` scope; `write` is required for `POST`/`PATCH`/`PUT`/`DELETE`.

```sh
# write with a `write` key
curl -H "x-api-key: kanso_…" -H "content-type: application/json" \
  -d '{"title":"About","slug":"about","status":"published"}' \
  http://localhost:5173/api/v1/pages

# headless read with a `read` key
curl -H "x-api-key: kanso_…" "http://localhost:5173/api/v1/posts?type=blog&status=published"
```

Upload media with `curl -H "x-api-key: kanso_…" -F file=@photo.png -F alt="Photo" http://localhost:5173/api/v1/media`.

Post bodies are ProseMirror JSON (`bodyJson`); the server validates them, renders `bodyHtml`, and derives an effective excerpt at render time when no explicit excerpt is stored. The admin UI is a plain client of this API — `hc<ApiType>` from `apps/server` gives it end-to-end types.

Search with `GET /api/v1/search?q=…` (`read` scope). After applying `0004_search.sql`, run
`POST /api/v1/search/reindex` (`write` scope) to index existing bodies: the migration initially
indexes only their titles and stored excerpts. New and edited bodies are indexed automatically.

## Themes

Choose **Default** or **Paper** under **管理画面 → 設定 → サイト → テーマ** and save.
The change invalidates cached public pages immediately. Default uses sans-serif text and a
left-aligned header; Paper uses serif text, a centered masthead and a warm paper background.
Both support light and dark mode.

A bundled theme exports a `Theme` with `name`, `Layout`, `PostList` and `PostArticle` from
`apps/server/src/site/themes/<name>/index.ts`. Its stylesheet lives at
`apps/server/public/themes/<name>.css` and imports `base.css` for shared content and forms.
Paper intentionally reuses Default's `PostList` and `PostArticle` with its own layout and CSS.

To add a theme in your fork:

1. Add its name and label/description to `THEME_NAMES` and `THEMES` in
   `packages/shared/src/themes.ts`.
2. Create the theme directory and components using the props in `site/themes/types.ts`, then
   register its export in `site/themes/index.ts`.
3. Add its CSS, importing `base.css` and defining the font, color (including `--color-error`)
   and measure variables. Link it from the layout and set the body's `theme-<name>` class.
   Keep the shared `Head`, navigation, search form and optional scripts in the layout.
4. Rebuild and deploy; the new theme appears in the settings selector. No plugin loader or
   extra dependencies are needed.

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
| `pnpm typecheck` | Type-check Playwright config/E2E and every package |
| `pnpm test` | Vitest in every package that has tests |
| `pnpm e2e` / `pnpm e2e:install` | Run Playwright E2E / install its Chromium browser |
| `pnpm check` / `pnpm format` | Biome lint + format |
| `pnpm types` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `pnpm db:generate` | Generate a SQL migration from the Drizzle schema |
| `pnpm db:migrate:local` / `pnpm db:migrate` | Apply migrations to local / remote D1 |
| `pnpm passkey:link <email> [--remote] [--url <site>]` | Issue a one-time link that registers a new passkey (account recovery) |

CI (GitHub Actions, `.github/workflows/ci.yml`) runs the four gates and the Playwright E2E on every push to `main` and on pull requests.

## License

MIT
