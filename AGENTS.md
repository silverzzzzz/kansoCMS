# AGENTS.md

Instructions for AI coding agents. They apply to the kansoCMS repository and to sites created
from it with `create-kanso`, which copies this file. People read [README.md](README.md); the
deployment guide for people is [docs/deploy.md](docs/deploy.md) (Japanese). When you change the
deployment steps in one of the two files, change the other as well.

## Basics

- The repository is a pnpm 12 workspace (`packageManager` in `package.json`). npm, Yarn and Bun
  cannot install it.
- pnpm refuses dependency versions published less than a day ago (`minimumReleaseAge` in
  `pnpm-workspace.yaml`). When an install fails because a version is too new, wait or pick an
  older version; do not add an exclusion just to get past it.
- Gates: `pnpm typecheck && pnpm check && pnpm test && pnpm build`.
- `pnpm audit` must report nothing; `.github/workflows/security.yml` runs it on every push and
  pull request and weekly. Fix an advisory by raising the dependency (`pnpm update -r <name>`
  also updates an indirect one within its dependents' ranges). Only when a dependent's range
  keeps the vulnerable version, add an `overrides` entry with the reason to `pnpm-workspace.yaml`.
- Local development: `pnpm db:migrate:local`, then `pnpm dev` (server on :5173, admin on :5174).
  Local D1 and R2 are emulated under `apps/server/.wrangler/`; nothing local reaches Cloudflare.
- Run the deploy script as `pnpm run deploy`. `pnpm deploy` is pnpm's built-in "deploy a
  workspace package" command and never runs the script.

## Deploying to production

### Rules

- Every step acts on the user's Cloudflare account and publishes a site. Ask before each of:
  `wrangler login`, creating or deleting a D1 database or R2 bucket, `pnpm db:migrate`,
  `pnpm run deploy` (the first one also creates the D1 database and R2 bucket, or connects to
  existing ones with the same names), `pnpm setup:token`, `wrangler secret put`, and any command
  with `--remote`.
- `apps/server/wrangler.jsonc` has no `database_id`: wrangler provisions D1 and R2 by name on
  deploy. `preview_database_id` only names the local database file; never remove it.
- You cannot finish the setup yourself. The user creates the first administrator's passkey in
  their own browser with their own authenticator.
- Outside `localhost`, setup is locked until the Worker has a `SETUP_TOKEN` secret of at least 16
  characters (`apps/server/src/api/setup-token.ts`); `GET /api/v1/setup` reports
  `"token":"unset"` until then. `pnpm setup:token --url https://<host>` stores a random token and
  prints `https://<host>/_admin/setup#token=…`. Whoever has that link can create the
  administrator: give it only to the user and never write it to files, commits or logs.
- Passkeys are bound to the hostname they were created on (`apps/server/src/api/relying-party.ts`).
  Passkeys from `localhost` or `*.workers.dev` do not work on another domain, so the user creates
  the administrator on the final production domain.
- Never ask for secret values in chat. The user runs `wrangler secret put <NAME>` and types the
  value at its prompt.
- The URL printed by `pnpm passkey:link` signs someone in. Show it only to the user; do not write
  it to files, commits or logs.
- In the upstream repository (`silverzzzzz/kansoCMS`, public), do not commit a real
  `database_id`, `SITE_URL` or `routes`: `create-kanso` copies `apps/server/wrangler.jsonc` into
  new sites. An interactive `wrangler deploy` writes `database_id` back into that file (and
  reformats it); discard that change upstream. Suggest a separate site project instead:
  `node packages/create-kanso/bin/create-kanso.mjs ../<dir> --from . --site-url https://<host>`.
  In a site's own repository, committing these values is normal.
- `pnpm db:migrate:local` and `pnpm passkey:link` without `--remote` act on the local emulation;
  `pnpm db:migrate` and every `--remote` command act on production.

### Steps

Run everything from the repository root.

1. Ask the user for the production hostname (a custom domain on a zone in their Cloudflare
   account, or `*.workers.dev`), whether to install the starter site, and whether local content
   will be moved.
2. Run `pnpm --filter @kanso/server exec wrangler whoami`. If nobody is signed in, ask the user to
   run `pnpm --filter @kanso/server exec wrangler login` (it opens a browser).
3. Read `name`, `d1_databases[0].database_name` and `r2_buckets[0].bucket_name` from
   `apps/server/wrangler.jsonc`. The D1 name in the `db:migrate` and `db:migrate:local` scripts of
   `apps/server/package.json` must match `database_name`.
4. Do not create D1 or R2 by hand. Check that the names are not used by another site in the
   account (read-only):

   ```sh
   pnpm --filter @kanso/server exec wrangler d1 list
   pnpm --filter @kanso/server exec wrangler r2 bucket list
   ```

   A deploy connects silently to an existing database or bucket with the same name. If a name is
   taken, ask the user for new names and change `name`/`database_name`/`bucket_name` and the D1
   name in the `db:migrate` scripts.
5. Set `vars.SITE_URL` to the production origin (`https://<host>`, no path). For a custom domain,
   add `"routes": [{ "pattern": "<host>", "custom_domain": true }]`, or let the user add the
   domain in the dashboard.
6. Run the gates. All four must pass.
7. First deploy: `pnpm run deploy`, which creates the D1 database and R2 bucket, then
   `pnpm db:migrate` (wrangler asks for confirmation). This order applies only the first time,
   because the database does not exist before the deploy; until the migration the site answers
   500. Agent runs are non-interactive, so wrangler does not write `database_id` back. Note the
   URL it prints. If `SITE_URL` was still unknown (workers.dev), set it now and run
   `pnpm run deploy` again. Setup stays locked; `GET /api/v1/setup` returns
   `{"needed":true,"token":"unset"}`.
8. `pnpm setup:token --url https://<host>` with the final hostname (or let the user run it). Hand
   the printed link to the user and tell them to open it: the token is filled in; they enter site
   name, name and email, untick 「サンプルサイトを入れる」 if local content will be imported, and
   create the passkey when the browser asks. If the user prefers their own token, they run
   `pnpm --filter @kanso/server exec wrangler secret put SETUP_TOKEN` (16+ characters) and type
   it on the setup page.
9. Verify:

   ```sh
   curl -s https://<host>/api/v1/setup                               # {"needed":false,"token":"off"} once the admin exists
   curl -s https://<host>/api/v1/health                              # {"ok":true,...}
   curl -s -o /dev/null -w "%{http_code}\n" https://<host>/_admin/    # 200
   ```

   If the link leaked before the administrator existed, run `pnpm setup:token` again: the new
   token replaces the old one.
10. Optional features, described in the README:
    - Turnstile: the user saves the site key under 設定 → フォーム and runs
      `pnpm --filter @kanso/server exec wrangler secret put TURNSTILE_SECRET_KEY`.
    - Form email: `pnpm --filter @kanso/server exec wrangler email sending enable <domain>`, then
      sender and recipients under 設定 → フォーム.
    - Workers AI: uncomment `ai` in `apps/server/wrangler.jsonc`, run `pnpm types`, redeploy.
      Usage is billed to the user's account.

### Moving local content

The user does this in the admin after setup: ツール → エクスポート locally, ツール → インポート
in production. Content, menus, redirects and form definitions move (site settings optionally);
image files, users, API keys and form submissions do not. Image references whose R2 key is
missing in production are cleared and listed as warnings, so those images must be uploaded again.

### Updating a deployment

`pnpm install`, the gates, `pnpm db:migrate`, then `pnpm run deploy`. Apply migrations before
deploying (only the very first deploy goes the other way round).

### Recovering access

If another administrator exists, they issue a new link under ユーザー → リンクを再発行.
Otherwise someone with access to the Cloudflare account runs
`pnpm passkey:link <email> --remote --url https://<host>` (the link is valid for one hour and works
once). Use the same command after moving to a new domain.
