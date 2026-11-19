import { importBundleSchema } from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_KEEP, BACKUP_PREFIX, backupName, listBackups } from './backups.ts'
import { runBackup, runDaily } from './scheduled.ts'
import { createTestApp, type TestApp } from './testing.ts'

describe('daily backups', () => {
  let test: TestApp

  beforeEach(() => {
    test = createTestApp()
  })

  afterEach(() => {
    test.close()
    vi.restoreAllMocks()
  })

  it('names backups by UTC time so they sort chronologically', () => {
    expect(backupName(new Date('2026-11-20T18:00:05.123Z'))).toBe('kanso-20261120-180005.json')
  })

  it('writes the export with settings under backups/, never under media/', async () => {
    await test.signIn()
    await test.request('/api/v1/pages', {
      method: 'POST',
      json: { title: 'About', slug: 'about', status: 'published' },
    })

    test.resetQueries()
    const result = await runBackup(test.env, new Date('2026-11-20T18:00:00Z'))
    // The whole export is a handful of reads (Workers Free allows 50 per invocation).
    expect(test.queries()).toBeLessThanOrEqual(20)

    expect(result.name).toBe('kanso-20261120-180000.json')
    expect([...test.objects.keys()]).toEqual([`${BACKUP_PREFIX}${result.name}`])
    const stored = JSON.parse(
      new TextDecoder().decode(test.objects.get(`${BACKUP_PREFIX}${result.name}`)?.bytes),
    )
    expect(stored.pages.map((page: { path: string }) => page.path)).toEqual(['about'])
    expect(stored.settings).toBeDefined()
    // What ツール → インポート accepts.
    expect(importBundleSchema.safeParse(stored).success).toBe(true)

    // Not reachable through the public media route.
    expect((await test.request(`/media/../${BACKUP_PREFIX}${result.name}`)).status).toBe(404)
    expect((await test.request(`/media/${result.name}`)).status).toBe(404)
  })

  it(`keeps the newest ${BACKUP_KEEP}`, async () => {
    for (let day = 1; day <= BACKUP_KEEP + 2; day += 1) {
      await runBackup(test.env, new Date(Date.UTC(2026, 10, day, 18)))
    }
    const names = (await listBackups(test.bucket)).map((item) => item.name)
    expect(names).toHaveLength(BACKUP_KEEP)
    expect(names[0]).toBe('kanso-20261109-180000.json')
    expect(names.at(-1)).toBe('kanso-20261103-180000.json')
  })

  it('still runs the backup when the cleanup fails, and logs the failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    test.exec('drop table rate_limits')
    await runDaily(test.env, new Date('2026-11-20T18:00:00Z'))
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"job":"housekeeping"'))
    expect((await listBackups(test.bucket)).map((item) => item.name)).toEqual([
      'kanso-20261120-180000.json',
    ])
  })

  describe('API', () => {
    it('lists, creates and downloads backups for an administrator', async () => {
      await test.signIn()
      const created = await test.request('/api/v1/backups', { method: 'POST' })
      expect(created.status).toBe(201)
      const { item } = (await created.json()) as { item: { name: string } }

      const list = (await (await test.request('/api/v1/backups')).json()) as {
        items: { name: string; size: number }[]
      }
      expect(list.items.map((entry) => entry.name)).toEqual([item.name])

      const download = await test.request(`/api/v1/backups/${item.name}`)
      expect(download.status).toBe(200)
      expect(download.headers.get('content-disposition')).toBe(
        `attachment; filename="${item.name}"`,
      )
      expect(importBundleSchema.safeParse(await download.json()).success).toBe(true)

      expect((await test.request('/api/v1/backups/..%2Fmedia%2Fx.json')).status).toBe(404)
    })

    it('is closed to editors', async () => {
      await test.signIn({ role: 'editor' })
      expect((await test.request('/api/v1/backups')).status).toBe(403)
      expect((await test.request('/api/v1/backups', { method: 'POST' })).status).toBe(403)
    })
  })
})
