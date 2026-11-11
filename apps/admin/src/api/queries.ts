import type { PublicUser } from '@kanso/shared'
import { queryOptions } from '@tanstack/react-query'
import { api } from './client.ts'
import { unwrap } from './request.ts'

export type ListParams = {
  page?: string
  perPage?: string
  q?: string
  status?: 'draft' | 'published' | 'scheduled'
  trashed?: 'true'
}

export type PostsListParams = ListParams & { type?: string }
export type SubmissionsListParams = {
  page?: string
  perPage?: string
  unread?: 'true' | 'false'
}

async function getPages(params: ListParams) {
  return unwrap(api.pages.$get({ query: params }))
}

async function getPage(id: number) {
  return unwrap(api.pages[':id'].$get({ param: { id: String(id) } }))
}

async function getPageRevisions(id: number) {
  return unwrap(api.pages[':id'].revisions.$get({ param: { id: String(id) } }))
}

async function getPostTypes() {
  return unwrap(api['post-types'].$get())
}

async function getPostType(id: number) {
  return unwrap(api['post-types'][':id'].$get({ param: { id: String(id) } }))
}

async function getCategories(typeId: number) {
  return unwrap(api['post-types'][':typeId'].categories.$get({ param: { typeId: String(typeId) } }))
}

async function getPosts(params: PostsListParams) {
  return unwrap(api.posts.$get({ query: params }))
}

async function getPost(id: number) {
  return unwrap(api.posts[':id'].$get({ param: { id: String(id) } }))
}

async function getPostRevisions(id: number) {
  return unwrap(api.posts[':id'].revisions.$get({ param: { id: String(id) } }))
}

async function getTags(q?: string) {
  return unwrap(api.tags.$get({ query: q ? { q } : {} }))
}

async function getRedirects(q?: string) {
  return unwrap(api.redirects.$get({ query: q ? { q } : {} }))
}

async function getMenus() {
  return unwrap(api.menus.$get())
}

async function getMenu(id: number) {
  return unwrap(api.menus[':id'].$get({ param: { id: String(id) } }))
}

async function getMedia(params: ListParams) {
  const query = { page: params.page, perPage: params.perPage, q: params.q }
  return unwrap(api.media.$get({ query }))
}

async function getSettings() {
  return unwrap(api.settings.$get())
}

async function getForms() {
  return unwrap(api.forms.$get())
}

async function getForm(id: number) {
  return unwrap(api.forms[':id'].$get({ param: { id: String(id) } }))
}

async function getSubmissions(formId: number, params: SubmissionsListParams) {
  return unwrap(api.forms[':id'].submissions.$get({ param: { id: String(formId) }, query: params }))
}

async function getSubmission(formId: number, submissionId: number) {
  return unwrap(
    api.forms[':id'].submissions[':submissionId'].$get({
      param: { id: String(formId), submissionId: String(submissionId) },
    }),
  )
}

async function getApiKeys() {
  return unwrap(api['api-keys'].$get())
}

async function getSectionCatalog() {
  return unwrap(api.site.sections.$get({ query: {} }))
}

async function getThemeSettings() {
  return unwrap(api.settings.theme.$get())
}

async function getStarter() {
  return unwrap(api.starter.$get())
}

async function getPasskeys() {
  return unwrap(api.auth.passkeys.$get())
}

async function getAnalyticsSummary(days: number) {
  return unwrap(api.analytics.summary.$get({ query: { days: String(days) } }))
}

export type StarterStatus = Awaited<ReturnType<typeof getStarter>>

export type PageItem = Awaited<ReturnType<typeof getPage>>['item']
export type PageListItem = Awaited<ReturnType<typeof getPages>>['items'][number]
export type PageRevisionItem = Awaited<ReturnType<typeof getPageRevisions>>['items'][number]
export type PostTypeItem = Awaited<ReturnType<typeof getPostType>>['item']
export type CategoryItem = Awaited<ReturnType<typeof getCategories>>['items'][number]
export type PostItem = Awaited<ReturnType<typeof getPost>>['item']
export type PostRevisionItem = Awaited<ReturnType<typeof getPostRevisions>>['items'][number]
export type TagItem = Awaited<ReturnType<typeof getTags>>['items'][number]
export type RedirectItem = Awaited<ReturnType<typeof getRedirects>>['items'][number]
export type MenuListItem = Awaited<ReturnType<typeof getMenus>>['items'][number]
export type MenuItem = Awaited<ReturnType<typeof getMenu>>['item']
export type MediaItem = Awaited<ReturnType<typeof getMedia>>['items'][number]
export type FormListItem = Awaited<ReturnType<typeof getForms>>['items'][number]
export type FormItem = Awaited<ReturnType<typeof getForm>>['item']
export type SubmissionListItem = Awaited<ReturnType<typeof getSubmissions>>['items'][number]
export type SubmissionItem = Awaited<ReturnType<typeof getSubmission>>['item']
export type SectionCatalogItem = Awaited<ReturnType<typeof getSectionCatalog>>['items'][number]
export type SectionFieldDef = SectionCatalogItem['fields'][number]

export const pagesListQuery = (params: ListParams) =>
  queryOptions({
    queryKey: ['pages', 'list', params] as const,
    queryFn: () => getPages(params),
  })

export const pageQuery = (id: number) =>
  queryOptions({
    queryKey: ['pages', 'detail', id] as const,
    queryFn: () => getPage(id),
  })

export const pageRevisionsQuery = (id: number) =>
  queryOptions({
    queryKey: ['pages', id, 'revisions'] as const,
    queryFn: () => getPageRevisions(id),
  })

export const postTypesQuery = queryOptions({
  queryKey: ['post-types', 'list'] as const,
  queryFn: getPostTypes,
})

export const postTypeQuery = (id: number) =>
  queryOptions({
    queryKey: ['post-types', 'detail', id] as const,
    queryFn: () => getPostType(id),
  })

export const categoriesQuery = (typeId: number) =>
  queryOptions({
    queryKey: ['post-types', 'categories', typeId] as const,
    queryFn: () => getCategories(typeId),
  })

export const postsListQuery = (params: PostsListParams) =>
  queryOptions({
    queryKey: ['posts', 'list', params] as const,
    queryFn: () => getPosts(params),
  })

export const postQuery = (id: number) =>
  queryOptions({
    queryKey: ['posts', 'detail', id] as const,
    queryFn: () => getPost(id),
  })

export const postRevisionsQuery = (id: number) =>
  queryOptions({
    queryKey: ['posts', id, 'revisions'] as const,
    queryFn: () => getPostRevisions(id),
  })

export const tagsQuery = (q?: string) =>
  queryOptions({
    queryKey: ['tags', 'list', q ?? ''] as const,
    queryFn: () => getTags(q),
  })

export const redirectsQuery = (q?: string) =>
  queryOptions({
    queryKey: ['redirects', 'list', q ?? ''] as const,
    queryFn: () => getRedirects(q),
  })

export const menusListQuery = queryOptions({
  queryKey: ['menus', 'list'] as const,
  queryFn: getMenus,
})

export const menuQuery = (id: number) =>
  queryOptions({
    queryKey: ['menus', 'detail', id] as const,
    queryFn: () => getMenu(id),
  })

export const mediaListQuery = (params: ListParams) =>
  queryOptions({
    queryKey: ['media', 'list', params] as const,
    queryFn: () => getMedia(params),
  })

export const settingsQuery = queryOptions({
  queryKey: ['settings'] as const,
  queryFn: getSettings,
})

export const analyticsSummaryQuery = (days: number) =>
  queryOptions({
    queryKey: ['analytics', 'summary', days] as const,
    queryFn: () => getAnalyticsSummary(days),
  })

/** Whether the optional Workers AI binding is configured (changes only on deploy). */
export const aiStatusQuery = queryOptions({
  queryKey: ['ai', 'status'],
  queryFn: () => unwrap(api.ai.$get()),
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
})

export const sectionCatalogQuery = queryOptions({
  queryKey: ['site', 'sections'] as const,
  queryFn: getSectionCatalog,
})

export const themeSettingsQuery = queryOptions({
  queryKey: ['settings', 'theme'] as const,
  queryFn: getThemeSettings,
})

export const starterQuery = queryOptions({
  queryKey: ['starter'] as const,
  queryFn: getStarter,
})

/** The signed-in user's own passkeys. */
export const passkeysQuery = queryOptions({
  queryKey: ['auth', 'passkeys'] as const,
  queryFn: getPasskeys,
})

/** The signed-in user's author profile (slug / bio / avatar). */
export const profileQuery = queryOptions({
  queryKey: ['auth', 'profile'] as const,
  queryFn: () => unwrap(api.auth.profile.$get()).then((data) => data.profile),
})

export const formsListQuery = queryOptions({
  queryKey: ['forms', 'list'] as const,
  queryFn: getForms,
})

export const formQuery = (id: number) =>
  queryOptions({
    queryKey: ['forms', 'detail', id] as const,
    queryFn: () => getForm(id),
  })

export const submissionsListQuery = (formId: number, params: SubmissionsListParams) =>
  queryOptions({
    queryKey: ['forms', formId, 'submissions', 'list', params] as const,
    queryFn: () => getSubmissions(formId, params),
  })

export const submissionQuery = (formId: number, submissionId: number) =>
  queryOptions({
    queryKey: ['forms', formId, 'submissions', 'detail', submissionId] as const,
    queryFn: () => getSubmission(formId, submissionId),
  })

export const apiKeysQuery = queryOptions({
  queryKey: ['api-keys'] as const,
  queryFn: getApiKeys,
})

export const meQueryOptions = queryOptions({
  queryKey: ['auth', 'me'] as const,
  queryFn: async (): Promise<PublicUser | null> => {
    const data = await unwrap(api.auth.me.$get())
    return data.principal.kind === 'session' ? data.principal.user : null
  },
  staleTime: 5 * 60 * 1_000,
})

export const setupStatusQueryOptions = queryOptions({
  queryKey: ['setup', 'status'] as const,
  queryFn: () => unwrap(api.setup.$get()),
})
