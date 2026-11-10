import type { ContentStatus } from '@kanso/shared'

/** Published content whose date is still in the future (scheduled). */
export function isScheduled(item: { status: ContentStatus; publishedAt: string | null }) {
  return (
    item.status === 'published' &&
    item.publishedAt !== null &&
    new Date(item.publishedAt).getTime() > Date.now()
  )
}
