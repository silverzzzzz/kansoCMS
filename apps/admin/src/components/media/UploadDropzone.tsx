import { MEDIA_MAX_BYTES, MEDIA_MIME_TYPES } from '@kanso/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { api } from '../../api/client.ts'
import type { MediaItem } from '../../api/queries.ts'
import { unwrap } from '../../api/request.ts'
import { Alert, Button } from '../ui.tsx'

export function UploadDropzone({ onUploaded }: { onUploaded?: (item: MediaItem) => void }) {
  const inputId = useId()
  const queryClient = useQueryClient()
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [failures, setFailures] = useState<string[]>([])

  async function upload(files: File[]) {
    const rejected = files.filter(
      (file) =>
        file.size > MEDIA_MAX_BYTES ||
        !MEDIA_MIME_TYPES.includes(file.type as (typeof MEDIA_MIME_TYPES)[number]),
    )
    const accepted = files.filter((file) => !rejected.includes(file))
    let successCount = 0
    const messages = rejected.map((file) =>
      file.size > MEDIA_MAX_BYTES
        ? `${file.name}: 20 MB を超えています`
        : `${file.name}: 対応していない形式です`,
    )

    for (const [index, file] of accepted.entries()) {
      setProgress(`${index + 1} / ${accepted.length}`)
      try {
        const data = await unwrap(api.media.$post({ form: { file } }))
        successCount += 1
        onUploaded?.(data.item)
      } catch (error) {
        messages.push(
          `${file.name}: ${error instanceof Error ? error.message : 'アップロード失敗'}`,
        )
      }
    }
    setProgress(null)
    setFailures(messages)
    if (successCount > 0) {
      await queryClient.invalidateQueries({ queryKey: ['media'] })
    }
  }

  return (
    <div>
      <fieldset
        className={`border border-dashed p-6 text-center ${dragging ? 'border-neutral-950 bg-neutral-100' : 'border-neutral-300 bg-white'}`}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void upload(Array.from(event.dataTransfer.files))
        }}
      >
        <legend className="sr-only">メディアのアップロード</legend>
        <p className="text-sm text-neutral-700">ファイルをここにドロップ</p>
        <p className="my-2 text-xs text-neutral-500">または</p>
        <label htmlFor={inputId} className="inline-block cursor-pointer">
          <span className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:border-neutral-950">
            ファイルを選択
          </span>
        </label>
        <input
          id={inputId}
          className="sr-only"
          type="file"
          multiple
          accept={MEDIA_MIME_TYPES.join(',')}
          disabled={progress !== null}
          onChange={(event) => {
            void upload(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ''
          }}
        />
        {progress && <p className="mt-3 text-sm">アップロード中 {progress}</p>}
      </fieldset>
      {failures.length > 0 && (
        <div className="mt-3">
          <Alert tone="error">
            <p>アップロードできないファイルがありました。</p>
            <ul className="mt-1 list-disc pl-5">
              {failures.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <Button
              type="button"
              variant="secondary"
              size="small"
              className="mt-3"
              onClick={() => setFailures([])}
            >
              閉じる
            </Button>
          </Alert>
        </div>
      )}
    </div>
  )
}
