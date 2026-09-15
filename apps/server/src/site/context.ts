import type { Kanso } from '@kanso/core'
import { buildTitle, type PageMeta, type SiteContext } from '@kanso/seo'
import { resolveMessages, type SiteMessages } from '../i18n.ts'
import { formatDate } from './format.ts'
import type { NavItem } from './themes/default/layout.tsx'

/**
 * Per-request bundle of everything a public page needs beyond its own
 * content: settings, JSON-LD site context and navigation. Fetched once per
 * request by the site router and handed to page renderers.
 */
export interface SiteRequestContext {
  origin: string
  site: SiteContext
  nav: NavItem[]
  /** Post type whose archive is shown at `/` when no `home` page exists. */
  homePostTypeSlug: string | null
  messages: SiteMessages
  /** Build PageMeta with site-level defaults applied. */
  meta: (overrides: MetaOverrides) => PageMeta
  formatDate: (date: Date) => string
}

export type MetaOverrides = Omit<Partial<PageMeta>, 'title'> & {
  /** Page title without the site name; null/undefined yields the bare site name. */
  title?: string | null
  /** Request path used to build the canonical URL. */
  path: string
}

export async function loadSiteContext(kanso: Kanso, origin: string): Promise<SiteRequestContext> {
  const [settings, organization, topPages, postTypes] = await Promise.all([
    kanso.settings.site(),
    kanso.settings.organization(),
    kanso.pages.listPublishedTopLevel(),
    kanso.postTypes.list(),
  ])

  const site: SiteContext = {
    url: origin,
    name: settings.title,
    description: settings.description,
    locale: settings.locale,
    organization: organization.name ? organization : undefined,
  }

  const nav: NavItem[] = [
    ...topPages
      .filter((p) => p.path !== 'home')
      .map((p) => ({ label: p.title, href: `/${p.path}` })),
    ...postTypes.map((type) => ({ label: type.name, href: `/${type.slug}` })),
  ]

  return {
    origin,
    site,
    nav,
    homePostTypeSlug: settings.homePostTypeSlug,
    messages: resolveMessages(settings.locale),
    formatDate: (date) =>
      formatDate(date, { locale: settings.locale, timeZone: settings.timezone }),
    meta: ({ title, path, ...overrides }) => ({
      title: buildTitle(title, { siteName: settings.title }),
      description: settings.description,
      canonical: new URL(path, `${origin}/`).toString(),
      locale: settings.locale,
      siteName: settings.title,
      ogType: 'website',
      noindex: false,
      ...overrides,
    }),
  }
}
