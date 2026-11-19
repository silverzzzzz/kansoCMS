import { UPSTREAM } from './template.js'

/** @typedef {{name: string, d1: string, r2: string, siteUrl: string}} Project */
/** @typedef {(message: string) => void} Warn */

/** @param {string} text @param {RegExp} pattern @param {string} value
 * @param {string} label @param {Warn} warn */
function replace(text, pattern, value, label, warn) {
  if (!pattern.test(text)) {
    warn(`Could not find ${label}; edit it manually.`)
    return text
  }
  return text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`)
}

/** @param {string} text @param {Project} project @param {Warn} warn */
export function rewriteWrangler(text, project, warn) {
  const targets = [
    ['name', 'kanso', project.name],
    ['database_name', 'kanso', project.d1],
    ['bucket_name', 'kanso-media', project.r2],
    ['SITE_URL', 'http://localhost:5173', project.siteUrl],
  ]
  for (const [key, original, value] of targets) {
    if (value === undefined) continue
    const escaped = original?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    text = replace(
      text,
      new RegExp(`^([ \\t]*"${key}"[ \\t]*:[ \\t]*)"${escaped}"`, 'm'),
      value,
      `wrangler.jsonc ${key}`,
      warn,
    )
  }
  return text
}

/** @param {string} text @param {Project} project @param {Warn} warn */
export function rewriteServerPackage(text, project, warn) {
  for (const [key, flag] of [
    ['db:migrate:local', '--local'],
    ['db:migrate', '--remote'],
  ]) {
    text = replace(
      text,
      new RegExp(
        `^([ \\t]*"${key}"[ \\t]*:[ \\t]*)"wrangler d1 migrations apply kanso ${flag}"`,
        'm',
      ),
      `wrangler d1 migrations apply ${project.d1} ${flag}`,
      `server package.json ${key}`,
      warn,
    )
  }
  return text
}

/** @param {string} text @param {Project} project @param {Warn} warn */
export function rewriteRootPackage(text, project, warn) {
  return replace(
    text,
    /^([ \t]*"name"[ \t]*:[ \t]*)"kanso-cms"/m,
    project.name,
    'root package.json name',
    warn,
  )
}

/** @param {Project} project */
export function nextSteps(project) {
  return `npm install -g pnpm   # only without pnpm 12 or later
pnpm install
pnpm db:migrate:local
pnpm dev

Open http://localhost:5174/admin/setup to create your local admin user and its passkey (a
starter site is installed unless you untick it; remove it later under 設定 → サンプルサイト).

For production, set vars.SITE_URL in apps/server/wrangler.jsonc to your real domain, then:
pnpm run deploy    # the first deploy creates the D1 database ${project.d1} and the R2 bucket ${project.r2}
pnpm db:migrate    # creates the tables; until then the deployed site answers with errors
pnpm setup:token --url https://your-domain

A deploy connects to an existing D1 database or R2 bucket of the same name in your account, so
keep these names unique (check with wrangler d1 list and wrangler r2 bucket list). Later updates
run pnpm db:migrate before pnpm run deploy.

Open the printed link on your real domain to create your production admin user and its passkey.
The deployed site refuses setup until that token exists, so nobody else can take it; keep the
link private.
Passkeys belong to the domain they were created on. If you lose them all, issue a recovery link:
pnpm passkey:link you@example.com --remote --url https://your-domain

The full deployment guide is docs/deploy.md (Japanese); AI agents follow AGENTS.md.`
}

/** @param {Project} project */
export function generateReadme(project) {
  return `# ${project.name}

A kansoCMS site. Requires Node.js 22+, pnpm 12 or later and a Cloudflare account for deployment.
The project is a pnpm workspace, so npm, Yarn and Bun cannot install it.

## Next steps

${nextSteps(project)}

Site URL: ${project.siteUrl}

The complete CMS workspace, themes, Astro example, tests and CI are included.
See [Architecture](docs/architecture.md) and [kansoCMS](${UPSTREAM}).
`
}
