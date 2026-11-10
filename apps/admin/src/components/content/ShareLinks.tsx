import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client.ts'
import { ApiError } from '../../api/errors.ts'
import { unwrap } from '../../api/request.ts'
import { Alert, Button, inputClass } from '../ui.tsx'

/**
 * Draft share-link management for the page/post edit screens. Issuing a link
 * returns the URL once; only its hash is stored server-side.
 */
export function ShareLinks({ kind, id }: { kind: 'page' | 'post'; id: number }) {
  const queryClient = useQueryClient()
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const param = { id: String(id) }
  const resource = kind === 'page' ? api.pages : api.posts

  const links = useQuery({
    queryKey: ['share-links', kind, id] as const,
    queryFn: () => unwrap(resource[':id']['share-links'].$get({ param })),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['share-links', kind, id] })

  const issue = useMutation({
    mutationFn: () => unwrap(resource[':id']['share-links'].$post({ param })),
    onSuccess: async ({ item }) => {
      setIssuedUrl(item.url)
      setCopied(false)
      await invalidate()
    },
  })
  const revoke = useMutation({
    mutationFn: (linkId: string) =>
      unwrap(api['share-links'][':id'].$delete({ param: { id: linkId } })),
    onSuccess: invalidate,
  })
  const error = issue.error ?? revoke.error ?? links.error

  return (
    <section className="mt-8 border border-neutral-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">下書き共有リンク</h2>
        <Button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}>
          {issue.isPending ? '発行中…' : '共有リンクを発行'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        ログイン不要で 7 日間有効な下書きプレビュー URL を発行します。noindex/no-follow
        で出力されます。
      </p>
      {error && (
        <div className="mt-3">
          <Alert tone="error">
            {error instanceof ApiError ? error.message : '処理できませんでした'}
          </Alert>
        </div>
      )}
      {issuedUrl && (
        <div className="mt-3 flex gap-2">
          <input className={`${inputClass} font-mono text-xs`} readOnly value={issuedUrl} />
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(issuedUrl)
              setCopied(true)
            }}
          >
            {copied ? 'コピー済み' : 'コピー'}
          </Button>
        </div>
      )}
      {(links.data?.items.length ?? 0) > 0 && (
        <ul className="mt-4 divide-y divide-neutral-200">
          {links.data?.items.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-neutral-600">
                {new Date(link.expiresAt) > new Date()
                  ? `${new Date(link.expiresAt).toLocaleString('ja-JP')} まで有効`
                  : '期限切れ'}
              </span>
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(link.id)}
                className="text-sm text-red-700 underline disabled:text-neutral-400"
              >
                無効化
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
