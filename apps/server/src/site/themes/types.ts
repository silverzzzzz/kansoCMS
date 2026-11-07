import type { Kanso } from '@kanso/core'
import type { PageMeta } from '@kanso/seo'
import type { SectionField, SectionValues, ThemeName } from '@kanso/shared'
import type { Child, FC } from 'hono/jsx'

export interface NavItem {
  label: string
  href: string
}

export interface LayoutProps {
  meta: PageMeta
  jsonLd?: unknown[]
  nav: NavItem[]
  search: { label: string; placeholder: string; button: string }
  scripts?: string[]
  children: Child
}

export interface PostSummaryItem {
  id: number
  title: string
  href: string
  excerpt: string | null
  publishedAt: Date | null
}

export interface PostListProps {
  heading: string
  description?: string | null
  items: PostSummaryItem[]
  pagination: { page: number; totalPages: number; basePath: string }
  formatDate: (date: Date) => string
  messages: { newer: string; older: string }
}

type Post = Awaited<ReturnType<Kanso['posts']['getWithRelations']>>

export interface PostArticleProps {
  post: Post
  bodyHtml: string
  typeSlug: string
  formatDate: (date: Date) => string
}

export interface SectionImageData {
  url: string
  alt: string | null
}

export interface SectionPostsData {
  typeSlug: string
  typeName: string
  items: PostSummaryItem[]
}

/** Values of `image` / `posts` fields resolved to render-ready data, keyed by field name. */
export interface SectionResolvedData {
  images: Record<string, SectionImageData | null>
  posts: Record<string, SectionPostsData | null>
}

export interface SectionProps {
  /** Settings validated against the section's fields; missing keys hold field defaults. */
  values: SectionValues
  data: SectionResolvedData
  formatDate: (date: Date) => string
}

export interface SectionDefinition {
  label: string
  description?: string
  fields: SectionField[]
  Component: FC<SectionProps>
}

export interface Theme {
  name: ThemeName
  Layout: FC<LayoutProps>
  PostList: FC<PostListProps>
  PostArticle: FC<PostArticleProps>
  /** Sections the theme offers to the customize editor, keyed by section type. */
  sections: Record<string, SectionDefinition>
}
