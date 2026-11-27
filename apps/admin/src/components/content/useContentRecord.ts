import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  type ContentFormValue,
  mergeConfirmedContent,
  validateContent,
} from '../../lib/content-values.ts'
import { markCreated, useCreatedNotice } from '../editing/created-notice.ts'
import { useEditorLeaveGuard, useEditorSave } from '../editing/useEditorSave.ts'

type ContentRecord = { content: ContentFormValue }
type SavedRecord = { id: number; updatedAt: string; content: ContentFormValue }

export function useContentRecord<T extends ContentRecord>({
  kind,
  resource,
  item,
  initial,
  parse,
  write,
}: {
  kind: 'post' | 'page'
  resource: string
  item?: { id: number; updatedAt: string }
  initial: () => T
  parse: (value: unknown) => T | null
  write: (value: T, baseUpdatedAt?: string) => Promise<SavedRecord>
}) {
  const { user } = getRouteApi('/_auth').useRouteContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [value, setValue] = useState(initial)
  const [version, setVersion] = useState(item?.updatedAt ?? 'new')
  const [editorKey, setEditorKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [invalidBody, setInvalidBody] = useState(false)
  useEditorLeaveGuard(uploading || invalidBody)
  const initialSaved = useCreatedNotice(kind, item?.id ?? 0)
  const save = useEditorSave({
    value,
    initialSaved,
    isNew: !item,
    draft: {
      userId: user.id,
      resource,
      version,
      parse,
      restore: (restored: T, originalVersion: string) => {
        setValue(restored)
        setVersion(originalVersion)
        setEditorKey((key) => key + 1)
      },
    },
    onSave: async (snapshot, overwrite) => {
      if (uploading) throw new Error('画像のアップロードが完了してから保存してください。')
      if (invalidBody)
        throw new Error('本文に保存できない内容があります。本文を修正してから保存してください。')
      validateContent(snapshot.content)
      const result = await write(snapshot, item && !overwrite ? version : undefined)
      setVersion(result.updatedAt)
      const collection = kind === 'page' ? 'pages' : 'posts'
      await queryClient.invalidateQueries({ queryKey: [collection] })
      if (!item) {
        return async () => {
          markCreated(queryClient, kind, result.id)
          await navigate({
            to: kind === 'page' ? '/pages/$id' : '/posts/$id',
            params: { id: String(result.id) },
            replace: true,
          })
        }
      }
      const next = { ...snapshot, content: result.content }
      return {
        value: next,
        apply: () => setValue(next),
        merge: () =>
          setValue((current) => ({
            ...current,
            content: mergeConfirmedContent(snapshot.content, result.content, current.content),
          })),
      }
    },
  })
  return { value, setValue, save, editorKey, setUploading, setInvalidBody }
}
