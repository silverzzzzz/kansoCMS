import type { Kanso } from '@kanso/core'
import { raw } from 'hono/html'

type Post = Awaited<ReturnType<Kanso['posts']['getWithRelations']>>

export interface PostArticleProps {
  post: Post
  bodyHtml: string
  typeSlug: string
  formatDate: (date: Date) => string
}

export function PostArticle({ post, bodyHtml, typeSlug, formatDate }: PostArticleProps) {
  return (
    <article class="post">
      <h1>{post.title}</h1>
      <p class="post-meta">
        {post.publishedAt && (
          <time datetime={post.publishedAt.toISOString()}>{formatDate(post.publishedAt)}</time>
        )}
        {post.authorName && <span>{post.authorName}</span>}
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
      <div class="post-body">{raw(bodyHtml)}</div>
    </article>
  )
}
