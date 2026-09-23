import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { isTaskBoard, readTarGz, safePath } from './tar.js'

export const OWNER = 'silverzzzzz'
export const REPO = 'kansoCMS'
export const UPSTREAM = `https://github.com/${OWNER}/${REPO}`

/** @param {unknown} error */
export function isMissing(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Reject existing symlinks, including ancestors of the target and --force files.
 * @param {string} path */
export async function assertNoSymlinks(path) {
  const parent = dirname(path)
  if (parent !== path) await assertNoSymlinks(parent)
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

/** @param {string} target @param {boolean} force */
export async function prepareTarget(target, force) {
  await assertNoSymlinks(target)
  try {
    if ((await readdir(target)).length && !force) {
      throw new Error(
        `Target directory is not empty: ${target}. Use --force to overwrite matching files.`,
      )
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  await mkdir(target, { recursive: true })
}

/** @param {string} target @param {string} path */
async function destination(target, path) {
  const dest = resolve(target, safePath(path))
  const rel = relative(target, dest)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Unsafe template path: ${path}`)
  }
  await assertNoSymlinks(dest)
  return dest
}

/** @param {string} path */
export function skipLocal(path) {
  const parts = path.split('/')
  const name = parts.at(-1) ?? ''
  return (
    isTaskBoard(path) ||
    path === 'apps/server/public/admin' ||
    path.startsWith('apps/server/public/admin/') ||
    parts.some((part) =>
      [
        'node_modules',
        '.git',
        'dist',
        '.wrangler',
        '.astro',
        'test-results',
        'playwright-report',
      ].includes(part),
    ) ||
    name.endsWith('.tsbuildinfo') ||
    name === '.env' ||
    name === '.dev.vars' ||
    (name.startsWith('.dev.vars.') && name !== '.dev.vars.example')
  )
}

/** @param {string} source @param {string} target */
export async function copyCheckout(source, target) {
  const root = await realpath(source)
  const destRoot = await realpath(target)
  const rel = relative(root, destRoot)
  const reverse = relative(destRoot, root)
  const inside = (/** @type {string} */ path) =>
    !path || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  if (inside(rel) || inside(reverse))
    throw new Error('Source and target directories must not overlap.')
  /** @param {string} directory @param {string} [prefix] */
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`
      if (skipLocal(path) || entry.isSymbolicLink()) continue
      const sourcePath = resolve(directory, entry.name)
      const dest = await destination(target, path)
      if (entry.isDirectory()) {
        await mkdir(dest, { recursive: true })
        await visit(sourcePath, `${path}/`)
      } else if (entry.isFile()) {
        await mkdir(dirname(dest), { recursive: true })
        await copyFile(sourcePath, dest)
      }
    }
  }
  await visit(root)
}

/** @param {Buffer} tarball @param {string} target */
export async function extractTemplate(tarball, target) {
  // Parse the complete archive before writing any entries.
  for (const [path, contents] of readTarGz(tarball)) {
    const dest = await destination(target, path)
    if (contents === null) await mkdir(dest, { recursive: true })
    else {
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, contents)
    }
  }
}

/** @param {string} ref @param {typeof fetch} [fetcher] */
export async function downloadTemplate(ref, fetcher = fetch) {
  try {
    const response = await fetcher(
      `https://codeload.github.com/${OWNER}/${REPO}/tar.gz/${encodeURIComponent(ref)}`,
      {
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (response.status !== 200) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const cause =
      error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
    throw new Error(
      `Could not download the template: ${reason}${cause}. Use --from <dir|file.tar.gz> to work offline.`,
    )
  }
}

/** @param {string} target @param {{from?: string, ref: string}} options */
export async function loadTemplate(target, options) {
  if (options.from) {
    const source = resolve(options.from)
    if ((await lstat(source)).isDirectory()) await copyCheckout(source, target)
    else await extractTemplate(await readFile(source), target)
  } else await extractTemplate(await downloadTemplate(options.ref), target)
}
