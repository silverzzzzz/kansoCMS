import { IMAGE_SIZES, ResponsiveImg } from '../images.tsx'
import { standardSectionsMeta } from './sections-meta.ts'
import type { SectionDefinition, SectionProps } from './types.ts'

/**
 * Sections shared by the bundled themes. Styling comes from the `.section-*`
 * rules in /themes/base.css, so each theme's CSS variables apply automatically.
 */

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function bool(value: unknown): boolean {
  return value === true
}

/** Plain text split into paragraphs on blank lines; single newlines become <br>. */
function Paragraphs({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  return (
    <>
      {paragraphs.map((paragraph) => {
        const lines = paragraph.split('\n')
        return (
          <p>
            {lines.map((line, index) => (
              <>
                {index > 0 && <br />}
                {line}
              </>
            ))}
          </p>
        )
      })}
    </>
  )
}

function Hero({ values, data }: SectionProps) {
  const heading = str(values.heading)
  const text = str(values.text)
  const image = data.images.image ?? null
  const buttonLabel = str(values.button_label)
  const buttonUrl = str(values.button_url)
  return (
    <section class="section section-hero">
      {image && <ResponsiveImg image={image} class="section-hero-image" eager />}
      <div class="section-hero-body">
        {heading && <h1>{heading}</h1>}
        {text && <Paragraphs text={text} />}
        {buttonLabel && buttonUrl && (
          <p>
            <a class="section-button" href={buttonUrl}>
              {buttonLabel}
            </a>
          </p>
        )}
      </div>
    </section>
  )
}

function RichText({ values }: SectionProps) {
  const heading = str(values.heading)
  const body = str(values.body)
  return (
    <section class="section section-richtext">
      {heading && <h2>{heading}</h2>}
      {body && <Paragraphs text={body} />}
    </section>
  )
}

function PostListSection({ values, data, formatDate }: SectionProps) {
  const heading = str(values.heading)
  const source = data.posts.source ?? null
  return (
    <section class="section section-post-list">
      {heading && <h2>{heading}</h2>}
      {source?.items.map((item) => (
        <article class="post-summary">
          <h3>
            <a href={item.href}>{item.title}</a>
          </h3>
          {item.publishedAt && (
            <p class="post-meta">
              <time datetime={item.publishedAt.toISOString()}>{formatDate(item.publishedAt)}</time>
            </p>
          )}
          {item.excerpt && <p>{item.excerpt}</p>}
        </article>
      ))}
      {source && (
        <p class="section-post-list-more">
          <a href={`/${source.typeSlug}`}>{source.typeName}</a>
        </p>
      )}
    </section>
  )
}

function ImageWithText({ values, data }: SectionProps) {
  const heading = str(values.heading)
  const body = str(values.body)
  const image = data.images.image ?? null
  const reverse = bool(values.reverse)
  return (
    <section class={`section section-image-with-text${reverse ? ' is-reverse' : ''}`}>
      {image && <ResponsiveImg image={image} class="section-image" sizes={IMAGE_SIZES.half} />}
      <div class="section-image-with-text-body">
        {heading && <h2>{heading}</h2>}
        {body && <Paragraphs text={body} />}
      </div>
    </section>
  )
}

function Cta({ values }: SectionProps) {
  const heading = str(values.heading)
  const buttonLabel = str(values.button_label)
  const buttonUrl = str(values.button_url)
  return (
    <section class="section section-cta">
      {heading && <h2>{heading}</h2>}
      {buttonLabel && buttonUrl && (
        <p>
          <a class="section-button" href={buttonUrl}>
            {buttonLabel}
          </a>
        </p>
      )}
    </section>
  )
}

export const standardSections: Record<string, SectionDefinition> = {
  hero: { ...standardSectionsMeta.hero, Component: Hero },
  richtext: { ...standardSectionsMeta.richtext, Component: RichText },
  post_list: { ...standardSectionsMeta.post_list, Component: PostListSection },
  image_with_text: { ...standardSectionsMeta.image_with_text, Component: ImageWithText },
  cta: { ...standardSectionsMeta.cta, Component: Cta },
}
