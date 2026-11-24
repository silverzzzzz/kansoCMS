# kansoCMS

A minimal, WordPress-shaped CMS that runs entirely on Cloudflare (Workers + D1 + R2).

- Fixed pages (hierarchical) and posts grouped into post types (`blog`, `news`, …) with categories and tags
- Server-rendered HTML with JSON-LD, Open Graph, `sitemap.xml`, `robots.txt` and an Atom feed per post type — no client JS
- The same content over a headless JSON API (`/api/v1`, API-key auth) for Astro / Next / anything else
- Admin UI with a Tiptap editor, media library (R2) and draft preview
- Responsive images without an image service: the uploading browser makes 480 / 960 / 1600 px WebP copies, they are stored in R2 next to the original, and pages serve them with `srcset`
- Passwordless sign-in with passkeys (WebAuthn): Windows Hello, Touch ID, a phone or a security key — no passwords stored, no email service needed
- Several users with two roles (administrator / editor): an administrator invites people with a one-time registration link
- Revision history keeps the latest 20 pre-save states and restores them from the admin UI
- Manual 301/302 redirects and 410 (gone) rules, automatic redirects when published page paths or post slugs change, and a list of the public paths that answered 404 so they can be fixed
- Japanese and English full-text search across published pages and posts, with highlighted snippets (D1 FTS5)
- Bundled Default and Paper themes, switchable in site settings
- Shopify-style customize editor: compose pages from theme sections (hero, text, latest posts, …) with a live preview, plus theme-wide settings (accent color, footer, social links) — no code, no Liquid
- A starter site for a small business (sectioned home and services pages, about, contact form, news posts, images) installed at setup by default, and removable later without touching what you edited
- Scheduled publishing, a menu builder, trash with restore, content duplication and expiring draft-share links, pinned posts, a custom 404 page and maintenance mode
- Per-post-type custom fields, page templates and optional Workers AI assist (excerpt and SEO text from the body, image alt text from the image itself)
- Author archives with editable profiles, related posts and an automatic table of contents on articles
- Cookie-less analytics (daily D1 aggregation) and an activity log of every admin mutation
- A daily Cron Trigger that empties trash older than 30 days and removes expired links and sessions
- Full-site JSON export/import — content, menus, redirects and form definitions move between installs by slug in requests small enough for the Workers Free plan; media is referenced by key, not embedded
- One `wrangler deploy`, no servers, no Node runtime in production

Design notes live in [docs/architecture.md](docs/architecture.md) and the per-task decisions in
[docs/tasks/phase-1.md](docs/tasks/phase-1.md) (both Japanese).

> Status: **all planned phases complete** — blog + fixed pages, contact forms, full-text search,
> themes, the section-based customize editor, a removable starter site, passkey sign-in,
> user invitations, scheduled publishing, trash, menus, analytics, custom fields, author
> archives, responsive images, JSON export/import and an activity log all work from the admin
> UI. Everything runs on the Workers Free plan. The admin UI is Japanese only for now.

## Layout

```
apps/
  server/   Hono Worker: public SSR site, /api/v1, /media (R2), /_admin (static SPA), /preview
  admin/    React + Vite admin UI, built into apps/server/public/_admin
packages/
  create-kanso/  CLI for scaffolding a site from the upstream repository
  shared/   zod schemas & constants shared by server and admin
  core/     Drizzle schema, migrations, content pipeline and services (framework-agnostic)
  seo/      JSON-LD builders, <head> metadata, sitemap and Atom helpers (pure functions)
examples/
  astro-blog/  Astro SSG blog reading the headless API
docs/       architecture, deployment guide, task board and decisions
```

## Requirements

- Node.js 26 or later (CI runs on 26).
- pnpm 12 or later (for example `npm install -g pnpm`). pnpm then runs the version pinned in
  `package.json` (`packageManager`). The repository is a pnpm workspace: npm, Yarn and Bun cannot
  install it.
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
- `http://localhost:5174/_admin/` — admin UI with hot reload (proxies `/api` and `/media` to :5173)

On first run open `/_admin/setup`: enter the site name and the first admin, then create a passkey
when the browser asks (there are no passwords). On `localhost` that is all; a deployed site also
asks for a setup token (see [Deploy](#deploy)). Sign in at `/_admin/login` with that passkey, and add
passkeys for your other devices under **アカウント**. Passkeys work on `localhost` (any port) and on
HTTPS domains, not on IP addresses such as `127.0.0.1`, and they belong to the domain they were
created on. Setup installs the starter site unless you untick **サンプルサイトを入れる**; remove it (or add it later) under
設定 → サンプルサイト. Removal keeps pages and posts you edited, images still in use, forms with
submissions and post types you added posts to.

#### Users and roles

An administrator adds people under **ユーザー**: name, email address and role. That creates the
user and shows a registration link (valid for 7 days, single use) to hand over; the invitee opens
it, creates a passkey and is signed in. No email is sent, so no mail service is needed. Editors
work on content — pages, posts, media, forms, menus, redirects. Settings, users, API keys, the
sample site, raw HTML blocks and settings in an export/import are for administrators. The site
always keeps an administrator who can sign in: the last one with a passkey can be neither
demoted nor removed, and an invited administrator who has not registered yet does not count.
Removing a user can hand their posts to someone else.

#### Lost passkeys

Another administrator can issue a fresh registration link under **ユーザー → リンクを再発行**.
When there is no other administrator, anyone who can write to the site's D1 database can issue a
one-time link (valid for an hour) that registers a new passkey for an existing user and signs
them in:

```sh
pnpm passkey:link you@example.com                                   # local D1, prints http://localhost:5173/…
pnpm passkey:link you@example.com --remote --url https://example.com  # production D1
```

Upgrading from a version with passwords: `pnpm db:migrate` applies `0006_passkeys.sql`, which deletes
the stored password hashes. Sessions that are already signed in keep working, so add a passkey
under **アカウント** before they expire; otherwise use `pnpm passkey:link`.

To see the built admin served by the Worker itself, run `pnpm build` once; it lands in `apps/server/public/_admin/` and is served at `http://localhost:5173/_admin/`.

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
passkey screens are tested with Chromium's virtual authenticator. `e2e/accessibility.spec.ts` runs axe-core (WCAG 2.1 A/AA) on the public pages and every main admin screen and fails on serious or critical findings; `e2e/security-headers.spec.ts` fails on any Content-Security-Policy violation in the admin. Test pages and forms use the `e2e-` slug prefix and are deleted after the run. The
starter-site test installs and removes the starter site, and skips itself when the database
already has it installed.

### Unit and integration tests

`pnpm test` needs no Cloudflare account and no running server. Besides plain unit tests it runs
the services and the whole Worker against a real database: `@kanso/core/testing` puts Node's
built-in SQLite behind the D1 API with every migration applied, and `apps/server/src/testing.ts`
drives the real routes and middleware through it. That test database also enforces the D1
limits local development ignores — 100 bound parameters per statement, 50-byte `LIKE` patterns —
and counts queries, so a test can assert that a request stays inside the 50 queries a Workers
Free invocation gets.

### Workers AI (optional)

The "AI で生成" buttons (excerpt, SEO description, image alt text) are off by default and stay
hidden until the binding exists. To turn them on, uncomment the `ai` binding in
`apps/server/wrangler.jsonc` and run `pnpm types`. An AI binding always talks to Cloudflare, so
from then on `pnpm dev` needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`) and every suggestion is
billed to your account. Alt text is written by a vision model that is shown the stored image
(up to 4 MB; JPEG, PNG, WebP or GIF) — never guessed from the file name.

### Export and import

**ツール** downloads the site as one JSON file and imports such a file into another install.
Everything is matched by slug or path, so importing twice changes nothing, and updated pages and
posts keep their previous version as a revision. Images — covers, OG images, images inside
sections and custom fields — travel as R2 keys and are linked again when the target site has a
media row with the same key; otherwise the reference is cleared and listed as a warning. Form
definitions are included, form submissions are not.

A file is imported as a series of requests (structure, pages, posts, settings), at most 100 pages
and 100 posts each; the admin UI does the splitting, and `splitBundle` from `@kanso/shared` does
the same for API clients. Site settings are exported and imported only by an administrator signed
in to the admin; the sample-content manifest and the cache generation never leave their site.

### Images

Originals and every derived size live in the R2 bucket; no image service is involved. When an
image is uploaded, the admin UI draws 480, 960 and 1600 px wide WebP copies in the browser (only
sizes smaller than the original; JPEG where the browser cannot encode WebP) and stores them as
`<key>.w<width>.webp` next to it. The Worker never decodes pixels: it checks the format, the
width and the proportions from the file headers. Public pages then emit `srcset`, `sizes`,
`width` and `height` for covers, section images, custom fields and images in the body — the
body ones are added when the page is rendered, so existing content needs no re-save. Images
uploaded earlier (the sample site's included) get their copies from **メディア → 縮小版を作成**.
GIFs (animation) and AVIF files are served as they are.

### Scheduled cleanup

`apps/server/wrangler.jsonc` schedules the Worker once a day (`triggers.crons`, 18:00 UTC). The
run purges pages and posts that have been in the trash for 30 days, expired share links,
sessions, registration links and sign-in challenges, pageview rows older than 400 days and
rate-limit counters older than a day and missing-path counts not seen for 30 days — one D1
batch — and then writes the daily backup (see Backups and recovery). Locally a Cron Trigger does not fire by itself; call it with
`curl http://localhost:5173/cdn-cgi/handler/scheduled`.

### Form notifications (email)

Manage forms under **管理画面 → フォーム**. Each form has its own field definitions and a
submission inbox, and submissions can be downloaded as CSV. To enable Turnstile, save the site
key under **設定 → フォーム** and configure the Worker secret with
`pnpm --filter @kanso/server exec wrangler secret put TURNSTILE_SECRET_KEY`.
Insert a **フォーム** block from the editor toolbar to render a public form that works without JavaScript.

### Rate limits

Endpoints that anyone can call and that write to D1 or send mail are limited per client IP
(`apps/server/src/rate-limit.ts`): passkey sign-in, registration links and first-run setup share
30 requests per 10 minutes, and form submissions (the JSON API and the HTML forms alike) allow 10
per 10 minutes. A client over the limit gets `429` with `Retry-After`; an HTML form is shown again
with a message and the visitor's input. The counters live in the D1 table `rate_limits`, keyed by
a hash of the address, and are cleared by the daily run. The client is `CF-Connecting-IP`, so
requests that do not pass through Cloudflare (local development) are not counted.

### Security headers

The admin is served with a Content-Security-Policy that lets only its own bundle run (no inline
script, no eval) and forbids framing it (`apps/server/src/security-headers.ts`; the same value is
in `apps/server/public/_headers` for the files Static Assets serves directly). Files under
`/media/` carry a sandboxing CSP, so an uploaded file opened directly cannot run script, and
`Cross-Origin-Resource-Policy: cross-origin`, so a headless front end on another origin can embed
them. The public site has no CSP, leaving themes and custom head HTML free.

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
| `/old-path` | A managed 301/302 redirect, or 410 for a gone rule, when no published page or post matches the path; other misses are 404 and are counted under **リダイレクト → 見つからなかった URL** |
| `/search?q=…` | Published page/post search with highlighted snippets and `?q=…&page=2` pagination; noindexed content is excluded and the page itself is `noindex` |
| `/blog` | Post-type archive, 10 per page, `?page=2` … (`page=1` and invalid values redirect to the bare URL) |
| `/blog/hello-world` | A post: `BlogPosting` + `BreadcrumbList` JSON-LD, `og:type=article`, `rel=alternate` to the feed |
| `/blog/category/news`, `/blog/tag/cloudflare` | Filtered archives |
| `/blog/author/jane` | Author archive — exists only for authors with published posts in that post type (404 otherwise) |
| `/blog/feed.xml` | Atom feed of the 20 latest posts, `X-Robots-Tag: noindex` |
| `/sitemap.xml`, `/robots.txt` | Every indexable public URL — home, pages, posts, post-type/category/tag archives — with `lastmod`; empty when the site is set to noindex. With **設定 → AI の学習に使わないよう求める**, robots.txt adds `Content-Signal: search=yes, ai-train=no` and disallows the known AI training crawlers (GPTBot, ClaudeBot, Google-Extended …) while search stays open. It never names the admin, which answers `X-Robots-Tag: noindex` instead |
| `/preview/page/:id`, `/preview/post/:id` | Draft preview — admin session only, `noindex`, never cached |
| `/preview/share/<token>` | A draft shared through a link issued in the editor: no sign-in, valid 7 days, revocable, `noindex, nofollow`, never cached |
| `/media/…` | Uploaded files from R2, `immutable` |

Top-level slugs are shared between pages and post types, so a `blog` page and a `blog` post type cannot coexist. Content pages carry `WebSite` (and `Organization` once you fill in the organisation settings), `WebPage` / `CollectionPage`, canonical, OG and `rel=prev/next` metadata. A site-wide default OG image can be picked in settings — used whenever a page, post or archive doesn't set its own — fixed-page breadcrumbs include the published ancestor pages, and an X account in the organisation settings emits `twitter:site`. `noindex` works at three levels — per page/post, per post type (archives only, keeping posts indexable) and site-wide in settings — and drops the content out of the sitemap and on-site search alike. Search pages have no JSON-LD.

Public HTML is cached in the Workers Cache API for 60 s (`x-kanso-cache: HIT|MISS`). Every content write through the admin API rotates a site-wide cache generation, so changes show up immediately in every data centre; requests carrying an admin session bypass the cache.

## Using the API

For a complete headless frontend, see [examples/astro-blog](examples/astro-blog): an Astro 7 static blog that reads the API with a read key at build time. Its README covers setup, local development and static hosting.

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

`PATCH /api/v1/pages/:id` and `PATCH /api/v1/posts/:id` accept an optional `baseUpdatedAt`: the
`updatedAt` you started editing from. If the item has been saved since, the update is refused
with `409` and `error.code` `stale` instead of overwriting that save; send the update again
without `baseUpdatedAt` to overwrite on purpose. The admin editors always send it.

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
pnpm run deploy                             # the first deploy creates the D1 database and R2 bucket
pnpm db:migrate                             # apply migrations to the remote D1
pnpm setup:token --url https://example.com  # prints the /_admin/setup link with a setup token
```

Set `SITE_URL` in `apps/server/wrangler.jsonc` to your production origin; it is used for canonical URLs, JSON-LD, the sitemap and feeds.

`wrangler.jsonc` holds no `database_id`: wrangler creates the D1 database and the R2 bucket named
there on the first deploy, or connects to existing ones with the same names, so give each site
its own names (check with `wrangler d1 list` and `wrangler r2 bucket list`). That is why the
first deploy comes before the migration; later updates migrate first, then deploy. An
interactive deploy writes the real `database_id` back into `wrangler.jsonc`; `preview_database_id`
only names the local database file and stays as it is.

A deployed site refuses to create its first administrator until the Worker has a `SETUP_TOKEN`
secret, so nobody else can take it between the deploy and the setup. `pnpm setup:token`
generates one, stores it with `wrangler secret put` and prints a link that opens `/_admin/setup`
with the token filled in (or set your own value of 16+ characters with
`wrangler secret put SETUP_TOKEN` and type it on the setup page). Open the link on the
production domain: passkeys belong to the domain they were created on, so connect a custom
domain before that step. Once the administrator exists the token does nothing. The full
walkthrough — custom domains, the first administrator, moving local content, updates and lost
passkeys — is in [docs/deploy.md](docs/deploy.md) (Japanese); AI agents follow
[AGENTS.md](AGENTS.md).

The Workers Free plan is enough. Its limit of 50 D1 queries per request is what the write paths
are built around — the sample-site install, the JSON import and the daily cleanup each run as a
few batched statements, and tests pin their query counts. The deploy also registers the daily
Cron Trigger (Free allows five per account). What could not be measured outside Cloudflare is
CPU time: Free allows 10 ms per request, so the admin sends a large import in parts of 25 pages
or posts.

## Backups and recovery

- **Database.** D1 keeps its own history (Time Travel): 7 days on Workers Free, 30 days on
  Workers Paid, always on. To go back to a point in time:

  ```sh
  cd apps/server
  pnpm exec wrangler d1 time-travel info kanso                                   # current bookmark
  pnpm exec wrangler d1 time-travel restore kanso --timestamp=2026-11-12T03:00:00+09:00
  ```

  A restore overwrites the database in place and prints a bookmark of the state it replaced;
  restoring to that bookmark undoes it.
- **Files.** Media live in the R2 bucket and are not part of Time Travel or of the JSON export.
  Copy the bucket with any S3-compatible tool (for example `rclone sync`) if you need an
  off-site copy. Deleting a media item in the admin deletes its R2 objects for good.
- **Content as a file.** **ツール → エクスポート** gives a JSON file of the content, menus,
  redirects and form definitions (optionally settings) that can be imported into any install.
  It is the way to move a site or keep a readable copy; it does not carry users, API keys, form
  submissions or files.
- **Daily backups.** The daily run also writes that JSON, settings included, to the R2 bucket
  under `backups/` (`kanso-YYYYMMDD-HHMMSS.json`, UTC) and keeps the newest 7. Administrators
  find them under **ツール → バックアップ**, can download one or take one now, and restore by
  importing the file. `/media/*` serves only `media/` keys, so backups are never public. They
  cover the same things as the export, not files, users or submissions: Time Travel stays the
  full recovery point for the database.
- **Mistakes in the editor.** A deleted page or post waits in the trash for 30 days, and every
  save keeps the previous version among the latest 20 revisions.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run server and admin dev servers in parallel |
| `pnpm build` | Build admin, then the Worker (`apps/server/dist`) |
| `pnpm run deploy` | Build and `wrangler deploy` (`pnpm deploy` without `run` is pnpm's own command) |
| `pnpm typecheck` | Type-check Playwright config/E2E and every package |
| `pnpm test` | Vitest in every package that has tests |
| `pnpm e2e` / `pnpm e2e:install` | Run Playwright E2E / install its Chromium browser |
| `pnpm check` / `pnpm format` | Biome lint + format |
| `pnpm types` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `pnpm db:generate` | Generate a SQL migration from the Drizzle schema |
| `pnpm db:migrate:local` / `pnpm db:migrate` | Apply migrations to local / remote D1 |
| `pnpm passkey:link <email> [--remote] [--url <site>]` | Issue a one-time link that registers a new passkey (account recovery) |
| `pnpm setup:token [--url <site>]` | Set a random `SETUP_TOKEN` secret on the deployed Worker and print the setup link |

CI (GitHub Actions, `.github/workflows/ci.yml`) runs the four gates and the Playwright E2E on every push to `main` and on pull requests.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in public
issues.

pnpm refuses dependency versions published less than a day ago, versions published with weaker
provenance than earlier ones, and git or tarball URLs below the direct dependencies
(`pnpm-workspace.yaml`). The workflows pin every action to a commit SHA, Dependabot proposes
action and npm updates weekly, and `.github/workflows/security.yml` runs CodeQL,
[zizmor](https://docs.zizmor.sh/) and `pnpm audit`. GitHub's dependency graph cannot read pnpm
12's lockfile, so Dependabot raises no security alerts; the audit job, on every push and pull
request and every Monday, takes their place.

## License

MIT
