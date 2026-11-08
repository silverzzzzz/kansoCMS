#!/usr/bin/env node
// Issues a one-time link that lets an existing user register a passkey
// without signing in, e.g. after losing every passkey. Writing to D1 needs
// access to the Cloudflare account, which is what makes this safe.
//
//   pnpm passkey:link <email> [--remote] [--url <site URL>]
//
// The link is valid for one hour and works once. Only its SHA-256 is stored.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TTL_SECONDS = 60 * 60
const EMAIL_PATTERN = /^[^\s@'"`;\\]+@[^\s@'"`;\\]+$/

function exit(message) {
  console.error(message)
  console.error('Usage: pnpm passkey:link <email> [--remote] [--url <site URL>]')
  process.exit(1)
}

let email
let remote = false
let siteUrl = 'http://localhost:5173'
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--') continue
  if (arg === '--remote') remote = true
  else if (arg === '--local') remote = false
  else if (arg === '--url') siteUrl = args[++index] ?? ''
  else if (arg.startsWith('--url=')) siteUrl = arg.slice('--url='.length)
  else if (arg.startsWith('-')) exit(`Unknown option: ${arg}`)
  else if (email === undefined) email = arg
  else exit(`Unexpected argument: ${arg}`)
}

if (!email) exit('An email address is required.')
email = email.trim().toLowerCase()
if (!EMAIL_PATTERN.test(email)) exit(`Not an email address: ${email}`)

let origin
try {
  origin = new URL(siteUrl).origin
} catch {
  exit(`Not a URL: ${siteUrl}`)
}

const token = randomBytes(32).toString('base64url')
const id = createHash('sha256').update(token).digest('hex')
const quotedEmail = `'${email.replaceAll("'", "''")}'`
const sql =
  `insert into passkey_links (id, user_id, expires_at, created_at) ` +
  `select '${id}', id, unixepoch() + ${TTL_SECONDS}, unixepoch() ` +
  `from users where email = ${quotedEmail} returning user_id`

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(serverDir, 'package.json'))
const wranglerPackage = require.resolve('wrangler/package.json')
const wrangler = join(dirname(wranglerPackage), require(wranglerPackage).bin.wrangler)

let output
try {
  // `DB` is the binding name, so this keeps working when create-kanso renames
  // the database.
  output = execFileSync(
    process.execPath,
    [wrangler, 'd1', 'execute', 'DB', remote ? '--remote' : '--local', '--json', '--command', sql],
    { cwd: serverDir, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] },
  )
} catch {
  console.error('wrangler d1 execute failed (see above).')
  process.exit(1)
}

let rows
try {
  rows = JSON.parse(output).flatMap((result) => result.results ?? [])
} catch {
  console.error(`Unexpected output from wrangler:\n${output}`)
  process.exit(1)
}
if (rows.length === 0) {
  console.error(`No user has the email address ${email} (${remote ? 'remote' : 'local'} D1).`)
  process.exit(1)
}

console.log(`Passkey link for ${email} (valid for 1 hour, single use):`)
console.log(`${origin}/admin/passkey-link?token=${token}`)
