import { KANSO_API_KEY, KANSO_API_URL, KANSO_POST_TYPE } from 'astro:env/server'

export interface PostType {
  id: number
  slug: string
  name: string
  description: string | null
  hasCategories: boolean
  hasTags: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface ContentSummary {
  id: number
  slug: string
  title: string
  excerpt: string | null
  status: 'draft' | 'published'
  publishedAt: string | null
  seoTitle: string | null
  seoDescription: string | null
  noindex: boolean
  canonicalUrl: string | null
  ogMediaId: number | null
  createdAt: string
  updatedAt: string
}

export interface PostSummary extends ContentSummary {
  postTypeId: number
  coverMediaId: number | null
  authorId: number | null
}

export interface Post extends PostSummary {
  bodyJson: unknown
  bodyHtml: string
  categoryIds: number[]
  tagIds: number[]
}

export interface Category {
  id: number
  postTypeId: number
  slug: string
  name: string
  parentId: number | null
  sortOrder: number
}

export interface Tag {
  id: number
  slug: string
  name: string
}

export interface Media {
  id: number
  r2Key: string
  filename: string
  mime: string
  size: number
  width: number | null
  height: number | null
  alt: string | null
  createdAt: string
  url: string
}

export interface PageSummary extends ContentSummary {
  path: string
  parentId: number | null
  sortOrder: number
}

export interface Page extends PageSummary {
  bodyJson: unknown
  bodyHtml: string
}

const apiOrigin = new URL(KANSO_API_URL).origin

/**
 * `astro build` renders every page in one process and the layout asks for the
 * page list on each of them, so loaders are memoised for the build. `astro dev`
 * always refetches so new content shows up without a restart.
 */
const memo = new Map<string, Promise<unknown>>()
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (import.meta.env.DEV) return load()
  let hit = memo.get(key) as Promise<T> | undefined
  if (!hit) {
    hit = load()
    memo.set(key, hit)
  }
  return hit
}

/** Paths are relative to /api/v1; the key stays in Astro's server modules. */
export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${apiOrigin}/api/v1${path}`, {
    headers: { 'x-api-key': KANSO_API_KEY },
  })
  if (!response.ok) {
    throw new Error(`kansoCMS API ${response.status} ${response.statusText}: /api/v1${path}`)
  }
  return response.json() as Promise<T>
}

export function isLive<T extends Pick<ContentSummary, 'status' | 'publishedAt'>>(
  item: T,
): item is T & { publishedAt: string } {
  return (
    item.status === 'published' &&
    item.publishedAt !== null &&
    new Date(item.publishedAt) <= new Date()
  )
}

/** Both posts and pages are paginated; taxonomy endpoints are not. */
export async function listAll<T>(path: string): Promise<T[]> {
  const url = new URL(path, apiOrigin)
  const perPage = 100
  url.searchParams.set('perPage', String(perPage))
  const result: T[] = []
  for (let page = 1; ; page++) {
    url.searchParams.set('page', String(page))
    const { items } = await apiFetch<{ items: T[] }>(`${url.pathname}${url.search}`)
    result.push(...items)
    if (items.length < perPage) return result
  }
}

export function absolutizeMedia(html: string): string {
  return html.replace(/(\s(?:src|href)=["'])\/media\//gi, `$1${apiOrigin}/media/`)
}

export function stripFormPlaceholders(html: string): string {
  return html.replace(
    /<div\s+data-kanso-form=["'][^"']*["']\s*>\s*<\/div>/gi,
    '<p class="form-placeholder">(Contact form — open the original site to submit)</p>',
  )
}

export function textExcerpt(html: string, maxLength = 160): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match
      const code = entity.toLowerCase().startsWith('#x')
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    })
    .replace(/\s+/g, ' ')
    .trim()
  const characters = Array.from(text)
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join('')}…` : text
}

export function getSite() {
  return cached('site', loadSite)
}

async function loadSite() {
  const { items } = await apiFetch<{ items: PostType[] }>('/post-types')
  const postType = items.find((item) => item.slug === KANSO_POST_TYPE)
  if (!postType) {
    throw new Error(
      `kansoCMS post type "${KANSO_POST_TYPE}" does not exist. Check KANSO_POST_TYPE.`,
    )
  }
  const [categories, tags] = await Promise.all([
    apiFetch<{ items: Category[] }>(`/post-types/${postType.id}/categories`),
    apiFetch<{ items: Tag[] }>('/tags'),
  ])
  return {
    postType,
    categories: new Map(categories.items.map((item) => [item.id, item.name])),
    tags: new Map(tags.items.map((item) => [item.id, item.name])),
  }
}

function prepareBody(html: string): string {
  return stripFormPlaceholders(absolutizeMedia(html))
}

export function getPosts() {
  return cached('posts', loadPosts)
}

async function loadPosts() {
  const site = await getSite()
  const summaries = await listAll<PostSummary>(
    `/posts?type=${encodeURIComponent(site.postType.slug)}&status=published`,
  )
  const posts = await Promise.all(
    summaries.filter(isLive).map(async (summary) => {
      const { item } = await apiFetch<{ item: Post }>(`/posts/${summary.id}`)
      const cover = item.coverMediaId
        ? (await apiFetch<{ item: Media }>(`/media/${item.coverMediaId}`)).item
        : null
      return {
        ...item,
        bodyHtml: prepareBody(item.bodyHtml),
        excerpt: item.excerpt?.trim() || textExcerpt(prepareBody(item.bodyHtml)),
        cover: cover ? { ...cover, url: new URL(cover.url, apiOrigin).href } : null,
        type: site.postType.slug,
        categories: item.categoryIds.flatMap((id) => site.categories.get(id) ?? []),
        tags: item.tagIds.flatMap((id) => site.tags.get(id) ?? []),
      }
    }),
  )
  return posts
    .filter(isLive)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
}

export function getPages() {
  return cached('pages', loadPages)
}

async function loadPages() {
  const summaries = await listAll<PageSummary>('/pages?status=published')
  const pages = await Promise.all(
    summaries.filter(isLive).map(async (summary) => {
      const { item } = await apiFetch<{ item: Page }>(`/pages/${summary.id}`)
      return { ...item, bodyHtml: prepareBody(item.bodyHtml) }
    }),
  )
  return pages.filter(isLive)
}
