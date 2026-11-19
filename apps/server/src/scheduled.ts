import { createKanso } from '@kanso/core'
import { createBackup } from './backups.ts'
import type { Bindings } from './env.ts'

/**
 * Everything the daily Cron Trigger does, in order. A failure is logged and
 * does not stop the next job, so a failing backup never blocks the cleanup.
 */
export async function runDaily(env: Bindings, now = new Date()): Promise<void> {
  const jobs: [string, () => Promise<unknown>][] = [
    ['housekeeping', () => runHousekeeping(env, now)],
    ['backup', () => runBackup(env, now)],
  ]
  for (const [job, run] of jobs) {
    try {
      await run()
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          job,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }
}

/** Writes today's backup to R2 and keeps the newest seven (backups.ts). */
export async function runBackup(env: Bindings, now = new Date()) {
  return createBackup(createKanso({ db: env.DB, media: env.MEDIA }), now)
}

/**
 * The daily Cron Trigger (`triggers.crons` in wrangler.jsonc): empties trash
 * older than the retention period and removes expired links, sessions and
 * old pageview rows. Purged content leaves one line in the activity log.
 */
export async function runHousekeeping(env: Bindings, now = new Date()) {
  const kanso = createKanso({ db: env.DB, media: env.MEDIA })
  const report = await kanso.housekeeping.run(now)
  if (report.pages + report.posts > 0) {
    await kanso.activity.log({
      actor: 'system',
      action: 'purge',
      targetType: 'trash',
      summary: `ゴミ箱を自動で整理 (固定ページ ${report.pages} 件・投稿 ${report.posts} 件を完全削除)`,
    })
  }
  return report
}
