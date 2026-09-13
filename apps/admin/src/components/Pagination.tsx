import { Button } from './ui.tsx'

export function Pagination({
  page,
  perPage,
  total,
  onChange,
}: {
  page: number
  perPage: number
  total: number
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  if (pages <= 1) return null
  return (
    <nav className="mt-6 flex items-center justify-between gap-4" aria-label="ページ送り">
      <Button
        type="button"
        variant="secondary"
        size="small"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        前へ
      </Button>
      <p className="text-sm text-neutral-600">
        {page} / {pages} ページ
      </p>
      <Button
        type="button"
        variant="secondary"
        size="small"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        次へ
      </Button>
    </nav>
  )
}
