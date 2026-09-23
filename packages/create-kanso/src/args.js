import { basename, resolve } from 'node:path'

export const USAGE = `Usage: create-kanso [dir] [options]

Options:
  --site-url <url>  Site URL (default: https://example.com)
  --name <name>     Worker name (default: derived from directory)
  --d1 <name>       D1 database name (default: Worker name)
  --r2 <name>       R2 bucket name (default: <name>-media)
  --ref <git-ref>   Upstream ref (default: main)
  --from <path>     Local checkout or .tar.gz instead of GitHub
  --force           Overwrite matching files in a nonempty directory
  --no-git          Skip git init
  --yes             Use defaults without prompts
  --help            Show this help
  --version         Show the CLI version

Default directory: my-site`

/** @typedef {{dir?: string, siteUrl?: string, name?: string, d1?: string, r2?: string,
 * ref: string, from?: string, force: boolean, git: boolean, yes: boolean,
 * help: boolean, version: boolean}} Options */

/** @param {string[]} argv @returns {Options} */
export function parseArgs(argv) {
  /** @type {Options} */
  const options = { ref: 'main', force: false, git: true, yes: false, help: false, version: false }
  /** @type {Record<string, 'siteUrl' | 'name' | 'd1' | 'r2' | 'ref' | 'from'>} */
  const values = {
    '--site-url': 'siteUrl',
    '--name': 'name',
    '--d1': 'd1',
    '--r2': 'r2',
    '--ref': 'ref',
    '--from': 'from',
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    const key = values[arg]
    if (key && Object.hasOwn(values, arg)) {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.\n\n${USAGE}`)
      options[key] = value
    } else if (arg === '--force') options.force = true
    else if (arg === '--no-git') options.git = false
    else if (arg === '--yes') options.yes = true
    else if (arg === '--help') options.help = true
    else if (arg === '--version') options.version = true
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}\n\n${USAGE}`)
    else if (options.dir !== undefined)
      throw new Error(`Only one directory is allowed.\n\n${USAGE}`)
    else options.dir = arg
  }
  return options
}

/** @param {string} name */
export function validateName(name) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    throw new Error('Worker name must match ^[a-z0-9][a-z0-9-]{0,62}$. Use --name to set it.')
  }
  return name
}

/** @param {string} dir */
export function deriveName(dir) {
  return validateName(
    basename(resolve(dir))
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
  )
}

/** @param {string} value */
export function validateSiteUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return value
  } catch {
    /* Report the same actionable message for all invalid URLs. */
  }
  throw new Error('Site URL must be an absolute http(s) URL. Use --site-url to set it.')
}

/** @param {Options} options */
export function resolveOptions(options) {
  const dir = options.dir ?? 'my-site'
  if (!dir.trim()) throw new Error('Target directory must not be empty.')
  const name = options.name === undefined ? deriveName(dir) : validateName(options.name)
  return {
    ...options,
    dir,
    name,
    d1: options.d1 ?? name,
    r2: options.r2 ?? `${name}-media`,
    siteUrl: validateSiteUrl(options.siteUrl ?? 'https://example.com'),
  }
}
