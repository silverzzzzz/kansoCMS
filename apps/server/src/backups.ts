import type { R2Bucket } from '@cloudflare/workers-types'
import type { Kanso } from '@kanso/core'
import { sectionFieldsOf } from './site/themes/sections-meta.ts'

/**
 * Daily backups (Phase 13 T75): the same JSON as ツール → エクスポート, with
 * site settings, written to the media bucket under `backups/`. `/media/*`
 * only serves keys under `media/`, so backups are never public. The newest
 * `BACKUP_KEEP` are kept. Like the export they hold no image files, users,
 * API keys or form submissions; D1 Time Travel stays the full recovery point.
 */
export const BACKUP_PREFIX = 'backups/'
export const BACKUP_KEEP = 7
const BACKUP_NAME = /^kanso-\d{8}-\d{6}\.json$/

export type BackupItem = { name: string; size: number; uploadedAt: string }

/** `kanso-YYYYMMDD-HHMMSS.json` in UTC: sorts by time and is safe in a URL and a file name. */
export function backupName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `kanso-${stamp}.json`
}

export function isBackupName(name: string): boolean {
  return BACKUP_NAME.test(name)
}

/** Newest first. */
export async function listBackups(bucket: R2Bucket): Promise<BackupItem[]> {
  const listed = await bucket.list({ prefix: BACKUP_PREFIX })
  return listed.objects
    .map((object) => ({
      name: object.key.slice(BACKUP_PREFIX.length),
      size: object.size,
      uploadedAt: object.uploaded.toISOString(),
    }))
    .filter((item) => isBackupName(item.name))
    .sort((a, b) => (a.name < b.name ? 1 : -1))
}

/** Deletes everything but the newest `BACKUP_KEEP` backups; returns the removed names. */
export async function pruneBackups(bucket: R2Bucket): Promise<string[]> {
  const stale = (await listBackups(bucket)).slice(BACKUP_KEEP).map((item) => item.name)
  if (stale.length > 0) await bucket.delete(stale.map((name) => `${BACKUP_PREFIX}${name}`))
  return stale
}

export async function createBackup(kanso: Kanso, now = new Date()) {
  const bundle = await kanso.transfer.export({ settings: true, sectionFields: sectionFieldsOf })
  const name = backupName(now)
  const body = JSON.stringify(bundle)
  await kanso.bucket.put(`${BACKUP_PREFIX}${name}`, body, {
    httpMetadata: { contentType: 'application/json' },
  })
  const removed = await pruneBackups(kanso.bucket)
  return { name, size: new TextEncoder().encode(body).byteLength, removed }
}
