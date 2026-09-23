import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs, resolveOptions, USAGE } from './args.js'
import {
  generateReadme,
  nextSteps,
  rewriteRootPackage,
  rewriteServerPackage,
  rewriteWrangler,
} from './rewrite.js'
import { assertNoSymlinks, isMissing, loadTemplate, prepareTarget } from './template.js'

/** @param {string} target */
export function initGit(target) {
  const existing = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: target,
    stdio: 'ignore',
  })
  if (existing.error || existing.status === 0) return
  const result = spawnSync('git', ['init'], { cwd: target, stdio: 'ignore' })
  if (result.status !== 0) console.warn('Warning: git init failed. You can initialize Git later.')
}

/** @param {string} target @param {import('./rewrite.js').Project} project
 * @param {import('./rewrite.js').Warn} [warn] */
export async function rewriteProject(target, project, warn = console.warn) {
  const manual = new Set()
  /** @type {[string, typeof rewriteWrangler][]} */
  const rewrites = [
    ['apps/server/wrangler.jsonc', rewriteWrangler],
    ['apps/server/package.json', rewriteServerPackage],
    ['package.json', rewriteRootPackage],
  ]
  for (const [file, rewrite] of rewrites) {
    const path = resolve(target, file)
    await assertNoSymlinks(path)
    /** @param {string} message */
    const warning = (message) => {
      manual.add(file)
      warn(`Warning: ${message}`)
    }
    try {
      const original = await readFile(path, 'utf8')
      await writeFile(path, rewrite(original, project, warning))
    } catch (error) {
      if (!isMissing(error)) throw error
      warning(`Missing ${file}; create it manually.`)
    }
  }
  const readme = resolve(target, 'README.md')
  await assertNoSymlinks(readme)
  await writeFile(readme, generateReadme(project))
  return [...manual]
}

/** @param {string[]} argv */
export async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(USAGE)
    return
  }
  if (options.version) {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    console.log(manifest.version)
    return
  }
  if (process.stdin.isTTY && process.stdout.isTTY && !options.yes) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    try {
      options.dir =
        (await prompt.question(`Directory (${options.dir ?? 'my-site'}): `)).trim() || options.dir
      options.siteUrl =
        (
          await prompt.question(`Site URL (${options.siteUrl ?? 'https://example.com'}): `)
        ).trim() || options.siteUrl
    } finally {
      prompt.close()
    }
  }
  const project = resolveOptions(options)
  const target = resolve(project.dir)
  await prepareTarget(target, project.force)
  await loadTemplate(target, project)
  const manual = await rewriteProject(target, project)
  if (project.git) initGit(target)
  console.log(
    `Created ${project.name} in ${target}.\n\nNext steps:\ncd "${project.dir}"\n${nextSteps(project)}`,
  )
  if (manual.length)
    console.log(
      `\nFiles requiring manual editing:\n${manual.map((file) => `- ${file}`).join('\n')}`,
    )
}
