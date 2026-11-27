import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { api } from '../../api/client.ts'
import type { MediaItem } from '../../api/queries.ts'
import { unwrap } from '../../api/request.ts'
import { Button } from '../ui.tsx'
import { MediaPicker } from './MediaPicker.tsx'

export function MediaField({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string
  hint?: string
  error?: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const detail = useQuery({
    queryKey: ['media', 'detail', value] as const,
    queryFn: () => unwrap(api.media[':id'].$get({ param: { id: String(value) } })),
    enabled: value !== null,
  })
  const item = selected?.id === value ? selected : detail.data?.item

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-neutral-800">{label}</legend>
      {item && (
        <div className="mt-2 flex items-center gap-3 border border-neutral-200 bg-white p-3">
          {item.mime.startsWith('image/') ? (
            <img
              className="h-20 w-28 bg-neutral-100 object-contain"
              src={item.url}
              alt={item.alt ?? ''}
            />
          ) : (
            <div className="flex h-20 w-28 items-center justify-center bg-neutral-100 text-xs">
              PDF
            </div>
          )}
          <p className="min-w-0 truncate text-sm">{item.filename}</p>
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="small"
          aria-label={`${label}を選択`}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
          }
          onClick={() => setOpen(true)}
        >
          選択
        </Button>
        {value !== null && (
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => {
              setSelected(null)
              onChange(null)
            }}
          >
            解除
          </Button>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-neutral-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
      <MediaPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(next) => {
          setSelected(next)
          onChange(next.id)
          setOpen(false)
        }}
      />
    </fieldset>
  )
}
