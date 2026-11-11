import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestKanso, type TestKanso } from '../testing/index.ts'
import { ACTIVITY_LOG_MAX_ROWS, FAILED_SIGN_IN_WINDOW_MS } from './activity.ts'

describe('activity log', () => {
  let test: TestKanso

  beforeEach(() => {
    test = createTestKanso()
  })
  afterEach(() => test.close())

  it('folds failed sign-ins within an hour into one row', async () => {
    await test.kanso.activity.log({
      actor: 'Admin',
      action: 'update',
      targetType: 'page',
      targetId: 1,
      summary: '固定ページを更新',
    })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await test.kanso.activity.logFailedSignIn('パスキー認証に失敗')
    }

    const rows = await test.kanso.activity.list()
    expect(rows.map((row) => [row.action, row.count])).toEqual([
      ['login_failed', 5],
      ['update', 1],
    ])
  })

  it('costs one query per repeated failure', async () => {
    await test.kanso.activity.logFailedSignIn('パスキー認証に失敗')
    test.resetQueries()
    await test.kanso.activity.logFailedSignIn('パスキー認証に失敗')
    expect(test.queries()).toBe(1)
  })

  it('starts a new row once the window has passed', async () => {
    const start = new Date()
    await test.kanso.activity.logFailedSignIn('パスキー認証に失敗', start)
    await test.kanso.activity.logFailedSignIn(
      'パスキー認証に失敗',
      new Date(start.getTime() + FAILED_SIGN_IN_WINDOW_MS + 5000),
    )

    const rows = await test.kanso.activity.list()
    expect(rows.map((row) => row.count)).toEqual([1, 1])
  })

  it('cannot be flooded past real history by failed sign-ins', async () => {
    await test.kanso.activity.log({
      actor: 'Admin',
      action: 'create',
      targetType: 'page',
      targetId: 1,
      summary: '固定ページを作成',
    })
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await test.kanso.activity.logFailedSignIn('パスキー認証に失敗')
    }
    expect(await test.kanso.activity.count()).toBe(2)
  })

  it('prunes rows beyond the cap', async () => {
    test.exec(`
      with recursive n(i) as (select 1 union all select i + 1 from n where i < ${ACTIVITY_LOG_MAX_ROWS})
      insert into activity_log (actor, action, target_type, summary) select 'seed', 'update', 'page', 'seed ' || i from n
    `)
    await test.kanso.activity.log({
      actor: 'Admin',
      action: 'update',
      targetType: 'page',
      summary: 'newest',
    })

    expect(await test.kanso.activity.count()).toBe(ACTIVITY_LOG_MAX_ROWS)
    const [newest] = await test.kanso.activity.list(1)
    expect(newest?.summary).toBe('newest')
  })
})
