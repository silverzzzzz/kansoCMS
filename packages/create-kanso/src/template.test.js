import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rewriteProject } from './index.js'
import { copyCheckout, downloadTemplate, prepareTarget, skipLocal } from './template.js'

/** @type {string[]} */
const temporary = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kanso-unit-'))
  temporary.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('template filesystem and download', () => {
  it('copies checkout sources while excluding build output, secrets and task boards', async () => {
    const source = await fixture()
    const target = await fixture()
    const omitted = [
      'node_modules/a',
      '.git/config',
      'apps/admin/dist/a',
      'apps/server/.wrangler/a',
      'examples/blog/.astro/a',
      'apps/server/public/admin/a',
      'test-results/a',
      'playwright-report/a',
      'a.tsbuildinfo',
      'apps/server/.dev.vars',
      'apps/server/.dev.vars.local',
      'examples/blog/.env',
      'docs/tasks/phase-3.md',
    ]
    const kept = [
      '.dev.vars.example',
      'docs/architecture.md',
      'examples/blog/src/a',
      'e2e/a',
      '.github/workflows/ci.yml',
      'packages/shared/package.json',
    ]
    for (const path of [...omitted, ...kept]) {
      const file = join(source, path)
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(file, 'fixture')
    }
    await copyCheckout(source, target)
    for (const path of omitted) {
      expect(skipLocal(path)).toBe(true)
      await expect(readFile(join(target, path))).rejects.toThrow()
    }
    for (const path of kept) expect(await readFile(join(target, path), 'utf8')).toBe('fixture')
  })
  it('rejects nonempty targets unless forced and preserves unrelated files', async () => {
    const target = await fixture()
    await writeFile(join(target, 'keep'), 'keep')
    await expect(prepareTarget(target, false)).rejects.toThrow('not empty')
    await prepareTarget(target, true)
    expect(await readdir(target)).toEqual(['keep'])
  })
  it('rejects overlapping source and target directories', async () => {
    const source = await fixture()
    const target = join(source, 'target')
    await mkdir(target)
    await expect(copyCheckout(source, target)).rejects.toThrow('must not overlap')
    await expect(copyCheckout(target, source)).rejects.toThrow('must not overlap')
  })
  it('refuses a destination junction without writing outside the target', async () => {
    const source = await fixture()
    const target = await fixture()
    const outside = await fixture()
    await mkdir(join(source, 'nested'))
    await writeFile(join(source, 'nested/file'), 'bad')
    await symlink(outside, join(target, 'nested'), 'junction')
    await expect(copyCheckout(source, target)).rejects.toThrow('symbolic link')
    expect(await readdir(outside)).toEqual([])
  })
  it('reports missing files for manual editing and still creates a README', async () => {
    const target = await fixture()
    /** @type {string[]} */
    const warnings = []
    expect(
      await rewriteProject(
        target,
        { name: 'site', d1: 'site', r2: 'site-media', siteUrl: 'https://example.com' },
        (message) => warnings.push(message),
      ),
    ).toEqual(['apps/server/wrangler.jsonc', 'apps/server/package.json', 'package.json'])
    expect(warnings).toHaveLength(3)
    expect(await readFile(join(target, 'README.md'), 'utf8')).toContain('# site')
  })
  it('fetches the encoded ref using an injected offline response', async () => {
    const result = await downloadTemplate('refs/heads/main', async (url) => {
      expect(String(url)).toBe(
        'https://codeload.github.com/silverzzzzz/kansoCMS/tar.gz/refs%2Fheads%2Fmain',
      )
      return new Response('archive')
    })
    expect(result.toString()).toBe('archive')
  })
  it('includes an offline hint for HTTP and network failures', async () => {
    await expect(
      downloadTemplate('bad', async () => new Response('', { status: 404 })),
    ).rejects.toThrow(/HTTP 404.*--from/)
    await expect(
      downloadTemplate('main', async () => {
        throw new Error('offline')
      }),
    ).rejects.toThrow(/offline.*--from/)
  })
})
