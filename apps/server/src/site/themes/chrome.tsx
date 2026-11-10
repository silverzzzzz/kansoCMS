import type { SectionValues } from '@kanso/shared'
import { raw } from 'hono/html'
import type { SiteExtras } from '../context.ts'
import type { NavItem } from './types.ts'

/**
 * Pieces of the page shell driven by theme-wide settings, shared by the
 * bundled layouts. Values are re-checked here so a layout can never inject
 * unvalidated text into a <style> block.
 */

function str(settings: SectionValues | undefined, name: string): string {
  const value = settings?.[name]
  return typeof value === 'string' ? value : ''
}

/**
 * Header/footer navigation, shared by the bundled layouts. Items with children
 * get a CSS-only dropdown (`:hover` / `:focus-within`, no client JS).
 */
export function SiteNav({ items }: { items: NavItem[] }) {
  return (
    <ul class="site-nav-list">
      {items.map((item) => (
        <li>
          <a href={item.href}>{item.label}</a>
          {item.children && item.children.length > 0 && (
            <ul class="site-nav-children">
              {item.children.map((child) => (
                <li>
                  <a href={child.href}>{child.label}</a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Favicon / Search Console verification / raw headHtml, emitted at the end of
 * `<head>`. `headHtml` is admin-only site settings (same trust level as the
 * raw-HTML content block).
 */
export function SiteHeadExtras({ extras }: { extras?: SiteExtras }) {
  if (!extras) return null
  return (
    <>
      {extras.faviconUrl && <link rel="icon" href={extras.faviconUrl} />}
      {extras.googleSiteVerification !== '' && (
        <meta name="google-site-verification" content={extras.googleSiteVerification} />
      )}
      {extras.headHtml && raw(extras.headHtml)}
    </>
  )
}

/** Raw `bodyEndHtml` injected just before `</body>` (admin-only setting). */
export function BodyEndExtras({ extras }: { extras?: SiteExtras }) {
  if (!extras?.bodyEndHtml) return null
  return raw(extras.bodyEndHtml)
}

export function AccentStyle({ settings }: { settings?: SectionValues }) {
  const accent = str(settings, 'accent')
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return null
  return <style>{raw(`:root{--color-accent:${accent}}`)}</style>
}

function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function FooterExtras({ settings }: { settings?: SectionValues }) {
  const footerText = str(settings, 'footer_text')
  const links = [1, 2, 3, 4, 5]
    .map((index) => str(settings, `sns_url_${index}`))
    .filter((url) => url !== '')
  if (!footerText && links.length === 0) return null
  return (
    <>
      {links.length > 0 && (
        <nav class="site-social">
          {links.map((url) => (
            <a href={url} rel="me noopener">
              {linkLabel(url)}
            </a>
          ))}
        </nav>
      )}
      {footerText && <p class="site-footer-text">{footerText}</p>}
    </>
  )
}
