import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import type { PostArticleProps, PostFieldItem } from '../types.ts'

/** Render one custom field value; returns null when there is nothing to show. */
function fieldNode(field: PostFieldItem, yes: string): Child {
  const { type, value, image, posts } = field
  if (type === 'image') {
    return image ? <img class="post-field-image" src={image.url} alt={image.alt ?? ''} /> : null
  }
  if (type === 'posts') {
    return posts && posts.items.length > 0 ? (
      <ul class="post-field-posts">
        {posts.items.map((item) => (
          <li>
            <a href={item.href}>{item.title}</a>
          </li>
        ))}
      </ul>
    ) : null
  }
  if (type === 'url') {
    return typeof value === 'string' && value ? <a href={value}>{value}</a> : null
  }
  if (type === 'checkbox') {
    return value === true ? yes : null
  }
  return value === null || value === undefined || value === '' ? null : String(value)
}

export function PostArticle({
  post,
  bodyHtml,
  typeSlug,
  formatDate,
  fields,
  toc,
  related,
  labels,
}: PostArticleProps) {
  const renderedFields = (fields ?? [])
    .map((field) => ({ field, node: fieldNode(field, labels?.yes ?? 'Yes') }))
    .filter((item) => item.node !== null)
  return (
    <article class="post">
      <h1>{post.title}</h1>
      <p class="post-meta">
        {post.publishedAt && (
          <time datetime={post.publishedAt.toISOString()}>{formatDate(post.publishedAt)}</time>
        )}
        {post.authorName &&
          (post.authorSlug ? (
            <a class="post-author" href={`/${typeSlug}/author/${post.authorSlug}`}>
              {post.authorName}
            </a>
          ) : (
            <span>{post.authorName}</span>
          ))}
      </p>
      {post.coverMedia && (
        <img
          class="post-cover"
          src={post.coverMedia.url}
          alt={post.coverMedia.alt ?? ''}
          width={post.coverMedia.width ?? undefined}
          height={post.coverMedia.height ?? undefined}
        />
      )}
      {(post.categories.length > 0 || post.tags.length > 0) && (
        <nav class="post-terms">
          {post.categories.map((category) => (
            <a href={`/${typeSlug}/category/${category.slug}`}>{category.name}</a>
          ))}
          {post.tags.map((tag) => (
            <a href={`/${typeSlug}/tag/${tag.slug}`}>#{tag.name}</a>
          ))}
        </nav>
      )}
      {toc && toc.length >= 2 && (
        <nav class="toc" aria-label={labels?.toc ?? 'Contents'}>
          <p class="toc-title">{labels?.toc ?? 'Contents'}</p>
          <ol>
            {toc.map((item) => (
              <li class={item.level === 3 ? 'toc-nested' : undefined}>
                <a href={`#${item.id}`}>{item.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div class="post-body">{raw(bodyHtml)}</div>
      {renderedFields.length > 0 && (
        <dl class="post-fields">
          {renderedFields.map(({ field, node }) => (
            <div class="post-field">
              <dt>{field.label}</dt>
              <dd>{node}</dd>
            </div>
          ))}
        </dl>
      )}
      {related && related.length > 0 && (
        <section class="related-posts">
          <h2>{labels?.related ?? 'Related posts'}</h2>
          <ul>
            {related.map((item) => (
              <li>
                <a href={item.href}>{item.title}</a>
                {item.publishedAt && (
                  <time datetime={item.publishedAt.toISOString()}>
                    {formatDate(item.publishedAt)}
                  </time>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
