import { createKanso } from '@kanso/core'
import type { Bindings } from './env.ts'

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
