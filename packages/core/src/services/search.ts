import type { SearchHitKind, SearchQuery, SnippetSegment } from '@kanso/shared'
import { eq, sql } from 'drizzle-orm'
import { EMPTY_DOCUMENT, plainText } from '../content/index.ts'
import type { Db } from '../db/client.ts'
import { pages, posts } from '../db/schema/index.ts'

export function searchTerms(q: string): string[] {
  return q.split(/\s+/).filter(Boolean).slice(0, 8)
}

export function matchExpression(terms: string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ')
}

export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

export function usesMatch(terms: string[]): boolean {
  return terms.length > 0 && terms.every((term) => term.length >= 3)
}

export function buildSnippet(text: string, terms: string[], radius = 60): SnippetSegment[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const escaped = terms.filter(Boolean).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  let first: RegExpExecArray | null = null
  for (const term of escaped) {
    first = new RegExp(term, 'iu').exec(normalized)
    if (first) break
  }
  if (!first) return [{ text: normalized.slice(0, 2 * radius), hit: false }]

  const start = Math.max(0, first.index - radius)
  const end = Math.min(normalized.length, first.index + first[0].length + radius)
  const window = normalized.slice(start, end)
  const segments: SnippetSegment[] = []
  if (start > 0) segments.push({ text: '…', hit: false })
  let cursor = 0
  // Collect overlapping occurrences too, then merge their highlight ranges.
  const ranges = escaped
    .flatMap((term) =>
      [...window.matchAll(new RegExp(`(?=(${term}))`, 'giu'))].map((hit) => ({
        start: hit.index,
        end: hit.index + (hit[1]?.length ?? 0),
      })),
    )
    .sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push(range)
  }
  for (const hit of merged) {
    if (hit.start > cursor) segments.push({ text: window.slice(cursor, hit.start), hit: false })
    segments.push({ text: window.slice(hit.start, hit.end), hit: true })
    cursor = hit.end
  }
  if (cursor < window.length) segments.push({ text: window.slice(cursor), hit: false })
  if (end < normalized.length) segments.push({ text: '…', hit: false })
  return segments
}

interface SearchRow {
  kind: SearchHitKind
  ref_id: number
  title: string
  excerpt: string
  body: string
  path: string
  published_at: number
  type_name: string | null
}

export function searchService(db: Db) {
  async function search({ q, page, perPage }: SearchQuery) {
    const terms = searchTerms(q)
    if (terms.length === 0) return { items: [], total: 0, page, perPage }

    const now = Math.floor(Date.now() / 1000)
    const match = usesMatch(terms)
    const query = match
      ? sql`search_index MATCH ${matchExpression(terms)}`
      : sql.join(
          terms.map((term) => {
            const pattern = likePattern(term)
            return sql`(s.title LIKE ${pattern} ESCAPE ${'\\'}
              OR s.excerpt LIKE ${pattern} ESCAPE ${'\\'}
              OR s.body LIKE ${pattern} ESCAPE ${'\\'})`
          }),
          sql` AND `,
        )
    const source = sql`FROM search_index s
      LEFT JOIN pages p ON s.kind = 'page' AND p.id = s.ref_id
      LEFT JOIN posts o ON s.kind = 'post' AND o.id = s.ref_id
      LEFT JOIN post_types t ON t.id = o.post_type_id
      WHERE ((s.kind = 'page' AND p.status = 'published'
        AND p.published_at IS NOT NULL AND p.published_at <= ${now})
        OR (s.kind = 'post' AND o.status = 'published'
        AND o.published_at IS NOT NULL AND o.published_at <= ${now}))
      AND ${query}`
    const order = match
      ? sql`bm25(search_index), published_at DESC`
      : sql`coalesce(p.published_at, o.published_at) DESC`
    const rows = await db.all<SearchRow>(sql`SELECT s.kind, s.ref_id, s.title, s.excerpt, s.body,
      coalesce(p.path, t.slug || '/' || o.slug) AS path,
      coalesce(p.published_at, o.published_at) AS published_at, t.name AS type_name
      ${source} ORDER BY ${order} LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`)
    const total = await db.get<{ total: number }>(sql`SELECT count(*) AS total ${source}`)
    return {
      items: rows.map((row) => ({
        kind: row.kind,
        id: row.ref_id,
        title: row.title,
        path: row.path,
        typeName: row.type_name ?? null,
        publishedAt: new Date(row.published_at * 1000),
        snippet: buildSnippet(`${row.excerpt} ${row.body}`.trim() || row.title, terms),
      })),
      total: total?.total ?? 0,
      page,
      perPage,
    }
  }

  async function reindex() {
    const [allPages, allPosts] = await Promise.all([
      db.select({ id: pages.id, bodyJson: pages.bodyJson }).from(pages),
      db.select({ id: posts.id, bodyJson: posts.bodyJson }).from(posts),
    ])
    const statements = [
      ...allPages.map((row) =>
        db
          .update(pages)
          .set({ searchText: plainText(row.bodyJson ?? EMPTY_DOCUMENT) })
          .where(eq(pages.id, row.id)),
      ),
      ...allPosts.map((row) =>
        db
          .update(posts)
          .set({ searchText: plainText(row.bodyJson ?? EMPTY_DOCUMENT) })
          .where(eq(posts.id, row.id)),
      ),
    ]
    for (let offset = 0; offset < statements.length; offset += 50) {
      const [first, ...rest] = statements.slice(offset, offset + 50)
      if (first) await db.batch([first, ...rest])
    }
    return { pages: allPages.length, posts: allPosts.length }
  }

  return { search, reindex }
}
