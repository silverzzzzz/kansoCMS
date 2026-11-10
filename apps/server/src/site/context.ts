import type { Kanso } from '@kanso/core'
import { absoluteUrl, buildTitle, type PageMeta, type SiteContext } from '@kanso/seo'
import { HEADER_MENU_SLUG, type SectionValues, sectionValuesSchemaFor } from '@kanso/shared'
import { resolveMessages, type SiteMessages } from '../i18n.ts'
import { formatDate } from './format.ts'
import { resolveTheme } from './themes/index.ts'
import type { NavItem, Theme } from './themes/types.ts'

/**
 * Per-request bundle of everything a public page needs beyond its own
 * content: settings, JSON-LD site context and navigation. Fetched once per
 * request by the site router and handed to page renderers.
 */
export interface SiteRequestContext {
  origin: string
  site: SiteContext
  nav: NavItem[]
  theme: Theme
  /** Post type whose archive is shown at `/` when no `home` page exists. */
  homePostTypeSlug: string | null
  /** Theme-wide settings for the active theme, validated with defaults applied. */
  themeSettings: SectionValues
  messages: SiteMessages
  search: Pick<SiteMessages['search'], 'label' | 'placeholder' | 'button'>
  /** Admin-controlled extras emitted by every layout (favicon, verification, raw HTML). */
  siteExtras: SiteExtras
  /** Build PageMeta with site-level defaults applied. */
  meta: (overrides: MetaOverrides) => PageMeta
  formatDate: (date: Date) => string
}

/** Site-wide head/body injections resolved once per request. */
export interface SiteExtras {
  faviconUrl: string | null
  googleSiteVerification: string
  headHtml: string | null
  bodyEndHtml: string | null
}

export type MetaOverrides = Omit<Partial<PageMeta>, 'title'> & {
  /** Page title without the site name; null/undefined yields the bare site name. */
  title?: string | null
  /** Request path used to build the canonical URL. */
  path: string
}

export async function loadSiteContext(kanso: Kanso, origin: string): Promise<SiteRequestContext> {
  const [settings, organization, allThemeSettings, topPages, postTypes, headerMenu] =
    await Promise.all([
      kanso.settings.site(),
      kanso.settings.organization(),
      kanso.settings.theme(),
      kanso.pages.listPublishedTopLevel(),
      kanso.postTypes.list(),
      kanso.menus.findBySlug(HEADER_MENU_SLUG),
    ])

  const orgLogoId = organization.logoMediaId ?? settings.logoMediaId
  const [ogMedia, orgLogoMedia, faviconMedia] = await Promise.all([
    settings.ogImageMediaId ? kanso.media.find(settings.ogImageMediaId) : null,
    orgLogoId ? kanso.media.find(orgLogoId) : null,
    settings.faviconMediaId ? kanso.media.find(settings.faviconMediaId) : null,
  ])
  const defaultOgImage = ogMedia ? absoluteUrl(origin, ogMedia.url) : null
  const orgLogoUrl = orgLogoMedia ? absoluteUrl(origin, orgLogoMedia.url) : null

  const site: SiteContext = {
    url: origin,
    name: settings.title,
    description: settings.description,
    locale: settings.locale,
    organization: organization.name ? { ...organization, logoUrl: orgLogoUrl } : undefined,
  }

  // A `header` menu overrides the generated navigation; without it the nav is
  // built from top-level pages and post types.
  const nav: NavItem[] =
    headerMenu !== null
      ? headerMenu.itemsJson.map((item) => ({
          label: item.label,
          href: item.href,
          children: item.children.length > 0 ? item.children : undefined,
        }))
      : [
          ...topPages
            .filter((p) => p.path !== 'home')
            .map((p) => ({ label: p.title, href: `/${p.path}` })),
          ...postTypes.map((type) => ({ label: type.name, href: `/${type.slug}` })),
        ]

  const messages = resolveMessages(settings.locale)
  const theme = resolveTheme(settings.theme)
  const themeValuesSchema = sectionValuesSchemaFor(theme.settingsFields)
  const storedThemeSettings = themeValuesSchema.safeParse(allThemeSettings[theme.name] ?? {})
  const themeSettings = storedThemeSettings.success
    ? storedThemeSettings.data
    : themeValuesSchema.parse({})
  return {
    origin,
    site,
    nav,
    homePostTypeSlug: settings.homePostTypeSlug,
    theme,
    themeSettings,
    messages,
    search: {
      label: messages.search.label,
      placeholder: messages.search.placeholder,
      button: messages.search.button,
    },
    siteExtras: {
      faviconUrl: faviconMedia ? faviconMedia.url : null,
      googleSiteVerification: settings.googleSiteVerification,
      headHtml: settings.headHtml,
      bodyEndHtml: settings.bodyEndHtml,
    },
    formatDate: (date) =>
      formatDate(date, { locale: settings.locale, timeZone: settings.timezone }),
    meta: ({ title, path, ogImage, ...overrides }) => ({
      title: buildTitle(title, { siteName: settings.title }),
      description: settings.description,
      canonical: new URL(path, `${origin}/`).toString(),
      locale: settings.locale,
      siteName: settings.title,
      siteDescription: settings.description,
      ogType: 'website',
      ogImage: ogImage ?? defaultOgImage,
      twitterSite: organization.twitterHandle ? `@${organization.twitterHandle}` : null,
      ...overrides,
      // Site-wide noindex cannot be overridden back; per-content flags still apply when off.
      noindex: settings.noindex || (overrides.noindex ?? false),
    }),
  }
}
