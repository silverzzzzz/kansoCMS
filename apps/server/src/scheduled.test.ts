import { TRASH_RETENTION_DAYS } from '@kanso/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHousekeeping } from './scheduled.ts'
import { createTestApp, type TestApp } from './testing.ts'

describe('scheduled housekeeping', () => {
  let test: TestApp

  beforeEach(() => {
    test = createTestApp()
  })
  afterEach(() => test.close())

  it('purges old trash and leaves one line in the activity log', async () => {
    const page = await test.kanso.pages.create(
      { title: 'Old', slug: 'old', status: 'draft' },
      { allowRawHtml: false },
    )
    await test.kanso.pages.delete(page.id)
    const longAgo = Math.floor(Date.now() / 1000) - (TRASH_RETENTION_DAYS + 2) * 86_400
    test.exec(`update pages set deleted_at = ${longAgo} where id = ${page.id}`)

    test.resetQueries()
    const report = await runHousekeeping(test.env)

    expect(report.pages).toBe(1)
    // One batch for the cleanup, then the log entry and its pruning check.
    expect(test.queries()).toBeLessThanOrEqual(4)
    const [entry] = await test.kanso.activity.list(1)
    expect(entry).toMatchObject({ actor: 'system', action: 'purge', targetType: 'trash' })
    expect(entry?.summary).toBe('ゴミ箱を自動で整理 (固定ページ 1 件・投稿 0 件を完全削除)')
  })

  it('stays silent when there is nothing to purge', async () => {
    test.resetQueries()
    await runHousekeeping(test.env)

    expect(test.queries()).toBe(1)
    expect(await test.kanso.activity.count()).toBe(0)
  })
})
