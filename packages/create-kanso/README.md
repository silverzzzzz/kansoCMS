# create-kanso

Create a kansoCMS site from the [upstream repository](https://github.com/silverzzzzz/kansoCMS).
Requires Node.js 22+; the generated project uses pnpm 10.32.1.
The CLI has no runtime dependencies and runs directly as JavaScript.

```sh
npm create kanso@latest my-site
# or
pnpm create kanso my-site
```

The npm package must be published before these commands are available. From this checkout:

```sh
node packages/create-kanso/bin/create-kanso.mjs my-site --yes
node packages/create-kanso/bin/create-kanso.mjs ../my-site --yes --from .
node packages/create-kanso/bin/create-kanso.mjs my-site --yes --from /path/to/kansoCMS-main.tar.gz
```

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `[dir]` | `my-site` | Target directory |
| `--site-url <url>` | `https://example.com` | Absolute HTTP(S) site URL |
| `--name <name>` | Derived from directory | Worker and root package name |
| `--d1 <name>` | Worker name | D1 database name |
| `--r2 <name>` | `<name>-media` | R2 bucket name |
| `--ref <git-ref>` | `main` | Upstream branch, tag or commit |
| `--from <path>` | GitHub download | Local checkout or `.tar.gz` archive |
| `--force` | Off | Overwrite matching files; retain unrelated existing files |
| `--no-git` | Off | Skip Git initialization |
| `--yes` | Off | Use defaults without prompts |
| `--help` | | Print usage |
| `--version` | | Print version |

The directory and site URL are prompted only when stdin and stdout are terminals and `--yes`
is absent. Supplied values are the prompt defaults. Worker names must match
`^[a-z0-9][a-z0-9-]{0,62}$`. Directory names are lowercased, invalid characters become hyphens,
and repeated/edge hyphens are removed. Use `--name` if no valid name remains or it is too long.
Unknown flags, invalid values and nonempty targets without `--force` exit with code 1.

## Generated project

The entire workspace is included: CMS server and admin, shared/core/SEO packages, CLI source,
themes, Astro example, architecture notes, tests, E2E configuration and GitHub Actions.
Only `docs/tasks/` is omitted from the upstream archive. Workspace directories remain intact so
the lockfile and CI can use `pnpm install --frozen-lockfile`.

Local checkout copies additionally omit `node_modules/`, `.git/`, `dist/`, `.wrangler/`, `.astro/`,
`apps/server/public/admin/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.dev.vars`,
`.dev.vars.*` (except `.dev.vars.example`) and `.env`. Symlinks are skipped in local sources;
archive links and extended headers are skipped. Source and target directories must not overlap.
Unsafe archive paths and destination symlinks are rejected, including with `--force`.

The CLI changes only deployment identifiers in `apps/server/wrangler.jsonc`, the two migration
scripts in `apps/server/package.json`, and the root package name, then replaces the root README.
JSONC comments and the placeholder `database_id` are preserved. Missing rewrite patterns produce
warnings and a final list of files to edit manually. Other code identifiers stay unchanged.

Git is initialized without a commit unless `--no-git` is given, Git is unavailable, or the target
is already inside a repository. The CLI never runs pnpm, Wrangler or Cloudflare commands.

## Next steps

For the default names of a `my-site` project:

```sh
cd my-site
pnpm install
pnpm --filter @kanso/server exec wrangler d1 create my-site
```

Paste the printed `database_id` into `apps/server/wrangler.jsonc`, then:

```sh
pnpm --filter @kanso/server exec wrangler r2 bucket create my-site-media
pnpm db:migrate:local
pnpm dev
```

Open `http://localhost:5174/admin/setup` to create your local admin account.
For production, set `vars.SITE_URL` in `apps/server/wrangler.jsonc` to your real domain, then:

```sh
pnpm db:migrate
pnpm deploy
```

Open `/admin/setup` on the deployed site to create the production admin account.
See the generated `docs/architecture.md` for the CMS design and deployment details.
