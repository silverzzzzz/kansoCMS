import { slugify } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { type TagItem, tagsQuery } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import { Alert, Button, inputClass } from './ui.tsx'

export function TagInput({
  value,
  onChange,
}: {
  value: TagItem[]
  onChange: (tags: TagItem[]) => void
}) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const suggestions = useQuery({
    ...tagsQuery(query.trim() || undefined),
    enabled: query.trim().length > 0,
  })
  const createTag = useMutation({
    mutationFn: ({ name, slug }: { name: string; slug: string }) =>
      unwrap(api.tags.$post({ json: { name, slug } })),
    onSuccess: async (data) => {
      if (!value.some((tag) => tag.id === data.item.id)) onChange([...value, data.item])
      setQuery('')
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })

  function select(tag: TagItem) {
    if (!value.some((current) => current.id === tag.id)) onChange([...value, tag])
    setQuery('')
  }

  function acceptInput() {
    const name = query.trim()
    if (!name) return
    const existing = suggestions.data?.items.find(
      (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
    if (existing) {
      select(existing)
      return
    }
    // Japanese names slugify to nothing, so ask for the slug instead of failing on the server.
    let slug = slugify(name)
    if (!slug) {
      const answer = window.prompt(`「${name}」のスラッグ（半角英数字とハイフン）`)
      if (answer === null) return
      slug = slugify(answer)
      if (!slug) return
    }
    createTag.mutate({ name, slug })
  }

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-800">
        タグ
        <input
          className={inputClass}
          value={query}
          placeholder="入力して Enter で追加"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            acceptInput()
          }}
        />
      </label>
      {query.trim() && suggestions.data && (
        <div className="mt-1 border border-neutral-200 bg-white p-1">
          {suggestions.data.items.slice(0, 8).map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="block w-full px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
              onClick={() => select(tag)}
            >
              {tag.name} <span className="text-neutral-500">{tag.slug}</span>
            </button>
          ))}
          {!suggestions.data.items.some(
            (tag) => tag.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
          ) && (
            <button
              type="button"
              className="block w-full px-2 py-1.5 text-left text-sm font-medium hover:bg-neutral-100"
              onClick={acceptInput}
            >
              「{query.trim()}」を新規作成
            </button>
          )}
        </div>
      )}
      {createTag.error && (
        <div className="mt-2">
          <Alert tone="error">
            {createTag.error instanceof ApiError
              ? createTag.error.message
              : 'タグを作成できませんでした'}
          </Alert>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {value.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-2 border border-neutral-300 bg-white px-2 py-1 text-sm"
          >
            {tag.name}
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => onChange(value.filter((current) => current.id !== tag.id))}
            >
              外す
            </Button>
          </span>
        ))}
      </div>
    </div>
  )
}
