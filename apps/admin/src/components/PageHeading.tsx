import type { ReactNode } from 'react'

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">{title}</h1>
        {description && <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
