import type { Kanso } from '@kanso/core'
import type { PageMeta } from '@kanso/seo'
import type { SectionField, SectionValues, ThemeName, TocItem } from '@kanso/shared'
import type { Child, FC } from 'hono/jsx'
import type { SiteExtras } from '../context.ts'

export interface NavItem {
  label: string
  href: string
  /** One level of dropdown children (menu builder). */
  children?: { label: string; href: string }[]
}

export interface LayoutProps {
  meta: PageMeta
  jsonLd?: unknown[]
  nav: NavItem[]
  search: { label: string; placeholder: string; button: string }
  scripts?: string[]
  /** Theme-wide settings validated against the theme's settingsFields. */
  themeSettings?: SectionValues
  /** Site-wide favicon / verification meta / raw-HTML injections. */
  extras?: SiteExtras
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
  /** Author avatar on author archives. */
  avatar?: { url: string; alt: string | null } | null
  items: PostSummaryItem[]
  pagination: { page: number; totalPages: number; basePath: string }
  formatDate: (date: Date) => string
  messages: { newer: string; older: string }
}

type Post = Awaited<ReturnType<Kanso['posts']['getWithRelations']>>

/** A custom field prepared for render; `image` / `posts` hold resolved data. */
export interface PostFieldItem {
  name: string
  label: string
  type: SectionField['type']
  value: SectionValues[string]
  image?: SectionImageData | null
  posts?: SectionPostsData | null
}

export interface PostArticleProps {
  post: Post
  bodyHtml: string
  typeSlug: string
  formatDate: (date: Date) => string
  /** Custom field values defined by the post type, in definition order. */
  fields?: PostFieldItem[]
  /** h2/h3 anchors extracted from the body; rendered when ≥2 items. */
  toc?: TocItem[]
  /** Same-category (or same-tag) published posts, newest first. */
  related?: PostSummaryItem[]
  labels?: { toc: string; related: string; yes: string }
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
  /** Theme-wide settings fields, edited in the customize editor. */
  settingsFields: SectionField[]
}
