import type { SectionValues } from '@kanso/shared'
import { raw } from 'hono/html'

/**
 * Pieces of the page shell driven by theme-wide settings, shared by the
 * bundled layouts. Values are re-checked here so a layout can never inject
 * unvalidated text into a <style> block.
 */

function str(settings: SectionValues | undefined, name: string): string {
  const value = settings?.[name]
  return typeof value === 'string' ? value : ''
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
