import type { ContentStatus, PublicUser } from '@kanso/shared'
import { queryOptions } from '@tanstack/react-query'
import { api } from './client.ts'
import { unwrap } from './request.ts'

export type ListParams = {
  page?: string
  perPage?: string
  q?: string
  status?: ContentStatus
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

async function getTags(q?: string) {
  return unwrap(api.tags.$get({ query: q ? { q } : {} }))
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

export type PageItem = Awaited<ReturnType<typeof getPage>>['item']
export type PageListItem = Awaited<ReturnType<typeof getPages>>['items'][number]
export type PostTypeItem = Awaited<ReturnType<typeof getPostType>>['item']
export type CategoryItem = Awaited<ReturnType<typeof getCategories>>['items'][number]
export type PostItem = Awaited<ReturnType<typeof getPost>>['item']
export type TagItem = Awaited<ReturnType<typeof getTags>>['items'][number]
export type MediaItem = Awaited<ReturnType<typeof getMedia>>['items'][number]
export type FormListItem = Awaited<ReturnType<typeof getForms>>['items'][number]
export type FormItem = Awaited<ReturnType<typeof getForm>>['item']
export type SubmissionListItem = Awaited<ReturnType<typeof getSubmissions>>['items'][number]
export type SubmissionItem = Awaited<ReturnType<typeof getSubmission>>['item']

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

export const tagsQuery = (q?: string) =>
  queryOptions({
    queryKey: ['tags', 'list', q ?? ''] as const,
    queryFn: () => getTags(q),
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
