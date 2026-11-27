import { SLUG_PATTERN, slugify } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import { type TagItem, tagsQuery } from '../api/queries.ts'
import { unwrap } from '../api/request.ts'
import { SlugField, TextField } from './fields.tsx'
import { Alert, Button } from './ui.tsx'

export const tagCreationKey = ['tags', 'create'] as const

export function TagInput({
  value,
  onChange,
}: {
  value: TagItem[]
  onChange: (tags: TagItem[]) => void
}) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [slug, setSlug] = useState<string | null>(null)
  const [slugError, setSlugError] = useState('')
  const entry = useRef<HTMLDivElement>(null)
  const enteringSlug = slug !== null
  useEffect(() => {
    if (enteringSlug) entry.current?.querySelector<HTMLInputElement>('[name="tagSlug"]')?.focus()
  }, [enteringSlug])
  const suggestions = useQuery({
    ...tagsQuery(query.trim() || undefined),
    enabled: query.trim().length > 0,
  })
  const createTag = useMutation({
    mutationKey: tagCreationKey,
    mutationFn: ({ name, slug }: { name: string; slug: string }) =>
      unwrap(api.tags.$post({ json: { name, slug } })),
    onSuccess: (data) => {
      queryClient.setQueryData(
        tagsQuery().queryKey,
        (old) => old && { ...old, items: [...old.items, data.item] },
      )
      if (!value.some((tag) => tag.id === data.item.id)) onChange([...value, data.item])
      setQuery('')
      setSlug(null)
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError: (error, input) => {
      if (error instanceof ApiError && error.code === 'conflict') {
        setSlug(input.slug)
        setSlugError('このスラッグは使用されています。別のスラッグを入力してください。')
      }
    },
  })

  function select(tag: TagItem) {
    if (!value.some((current) => current.id === tag.id)) onChange([...value, tag])
    setQuery('')
    setSlug(null)
  }

  function acceptInput() {
    const name = query.trim()
    if (!name || createTag.isPending) return
    const existing = suggestions.data?.items.find(
      (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
    if (existing) {
      select(existing)
      return
    }
    const next = slug ?? slugify(name)
    if (slug === null && !next) {
      setSlug('')
      return
    }
    if (!SLUG_PATTERN.test(next) || next.length > 120) {
      setSlug(next)
      setSlugError('半角英小文字・数字を使い、単語の間はハイフンで区切ってください。')
      return
    }
    createTag.mutate({ name, slug: next })
  }

  return (
    <div ref={entry}>
      <TextField
        label="タグ"
        value={query}
        disabled={createTag.isPending}
        maxLength={100}
        placeholder="入力して Enter で追加"
        onChange={(event) => {
          setQuery(event.target.value)
          setSlug(null)
          setSlugError('')
          createTag.reset()
        }}
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter' ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return
          event.preventDefault()
          acceptInput()
        }}
      />
      {slug !== null && (
        <div className="mt-3 space-y-2">
          <SlugField
            label={`「${query.trim()}」のスラッグ`}
            name="tagSlug"
            value={slug}
            error={slugError}
            disabled={createTag.isPending}
            onChange={(event) => {
              setSlug(event.target.value)
              setSlugError('')
            }}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter' ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              )
                return
              event.preventDefault()
              acceptInput()
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="small" disabled={createTag.isPending} onClick={acceptInput}>
              タグを追加
            </Button>
            <Button
              type="button"
              size="small"
              variant="secondary"
              disabled={createTag.isPending}
              onClick={() => {
                setSlug(null)
                setSlugError('')
                entry.current?.querySelector('input')?.focus()
              }}
            >
              キャンセル
            </Button>
          </div>
        </div>
      )}
      {slug === null && query.trim() && suggestions.data && (
        <div className="mt-1 border border-neutral-200 bg-white p-1">
          {suggestions.data.items.slice(0, 8).map((tag) => (
            <button
              key={tag.id}
              type="button"
              disabled={createTag.isPending}
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
      {createTag.error && !slugError && (
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
              disabled={createTag.isPending}
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
