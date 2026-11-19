#!/usr/bin/env node
// Unlocks first-run setup on a deployed site. Outside localhost, /admin/setup
// refuses to create the first administrator until the Worker has a
// SETUP_TOKEN secret, so nobody else can take the site between the deploy and
// the setup. This generates a random token, stores it with
// `wrangler secret put SETUP_TOKEN` (which needs access to the Cloudflare
// account) and prints the link that opens /admin/setup with the token filled
// in.
//
//   pnpm setup:token [--url <site URL>]
//
// Run it after the first `pnpm run deploy`. Running it again replaces the token.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function exit(message) {
  console.error(message)
  console.error('Usage: pnpm setup:token [--url <site URL>]')
  process.exit(1)
}

let siteUrl
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--') continue
  if (arg === '--url') siteUrl = args[++index] ?? ''
  else if (arg.startsWith('--url=')) siteUrl = arg.slice('--url='.length)
  else exit(`Unexpected argument: ${arg}`)
}

let origin
if (siteUrl !== undefined) {
  try {
    const url = new URL(siteUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol')
    origin = url.origin
  } catch {
    exit(`Not a site URL: ${siteUrl}`)
  }
}

// 24 random bytes: 32 base64url characters, well above the 16 the Worker requires.
const token = randomBytes(24).toString('base64url')

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(serverDir, 'package.json'))
const wranglerPackage = require.resolve('wrangler/package.json')
const wrangler = join(dirname(wranglerPackage), require(wranglerPackage).bin.wrangler)

try {
  // wrangler reads the secret value from stdin when it is not a terminal.
  execFileSync(process.execPath, [wrangler, 'secret', 'put', 'SETUP_TOKEN'], {
    cwd: serverDir,
    input: token,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
} catch {
  console.error(
    'wrangler secret put failed (see above). Sign in with `wrangler login` and deploy the Worker first (pnpm run deploy).',
  )
  process.exit(1)
}

console.log('')
if (origin) {
  console.log('Open this link to create the first administrator. Anyone with it can, so keep it')
  console.log('private; it stops working once the administrator exists.')
  console.log(`${origin}/admin/setup#token=${token}`)
} else {
  console.log('Setup token (keep it private; it stops working once the administrator exists):')
  console.log(token)
  console.log('Open https://<your site>/admin/setup and enter it, or run this again with')
  console.log('--url <site URL> to get a link (that replaces the token).')
}
