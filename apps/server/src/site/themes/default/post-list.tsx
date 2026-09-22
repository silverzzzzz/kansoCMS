import type { PostListProps } from '../types.ts'

function pageHref(basePath: string, page: number): string {
  return page === 1 ? basePath : `${basePath}?page=${page}`
}

export function PostList({
  heading,
  description,
  items,
  pagination,
  formatDate,
  messages,
}: PostListProps) {
  return (
    <section class="post-list">
      <h1>{heading}</h1>
      {description && <p>{description}</p>}
      {items.map((item) => (
        <article class="post-summary">
          <h2>
            <a href={item.href}>{item.title}</a>
          </h2>
          {item.publishedAt && (
            <p class="post-meta">
              <time datetime={item.publishedAt.toISOString()}>{formatDate(item.publishedAt)}</time>
            </p>
          )}
          {item.excerpt && <p>{item.excerpt}</p>}
        </article>
      ))}
      {pagination.totalPages > 1 && (
        <nav class="pagination">
          {pagination.page > 1 && (
            <a
              href={pageHref(pagination.basePath, pagination.page - 1)}
              aria-label={messages.newer}
            >
              ←
            </a>
          )}
          {pagination.page < pagination.totalPages && (
            <a
              href={pageHref(pagination.basePath, pagination.page + 1)}
              aria-label={messages.older}
            >
              →
            </a>
          )}
        </nav>
      )}
    </section>
  )
}
