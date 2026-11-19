import type { UserRole } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError } from '../../../api/errors.ts'
import { usersQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, Field, inputClass } from '../../../components/ui.tsx'
import { toAdminHref } from '../../../routing.ts'

export const Route = createFileRoute('/_auth/users/')({
  loader: ({ context }) =>
    context.user.role === 'admin' ? context.queryClient.ensureQueryData(usersQuery) : undefined,
  component: UsersPage,
})

type IssuedLink = { name: string; url: string; expiresAt: string; invited: boolean }

const roleLabels: Record<UserRole, string> = { admin: '管理者', editor: '編集者' }

const formatDateTime = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * The link is built here, on the origin this administrator signs in on: a
 * passkey belongs to the domain it is created on, so the invitee has to
 * register on the same one.
 */
function linkUrl(token: string): string {
  const path = toAdminHref(`/passkey-link?token=${encodeURIComponent(token)}`)
  return new URL(path, window.location.origin).toString()
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '処理できませんでした'
  if (error.status === 409) {
    if (/email/i.test(error.message)) return 'このメールアドレスのユーザーはすでにいます'
    if (/administrator/i.test(error.message)) {
      return 'ログインできる管理者がほかにいないため、変更できません (招待中の管理者は、パスキーを登録するまで数に入りません)'
    }
  }
  if (/own account/i.test(error.message)) return '自分自身は削除できません'
  return error.message
}

function UsersPage() {
  const { user: me } = Route.useRouteContext()
  const enabled = me.role === 'admin'
  const queryClient = useQueryClient()
  const users = useQuery({ ...usersQuery, enabled })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('editor')
  const [issued, setIssued] = useState<IssuedLink | null>(null)
  const [copied, setCopied] = useState(false)
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null)
  const [reassignTo, setReassignTo] = useState('')
  const [steppingDown, setSteppingDown] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })
  const show = (link: IssuedLink) => {
    setCopied(false)
    setIssued(link)
  }

  const invite = useMutation({
    mutationFn: () => unwrap(api.users.$post({ json: { name, email, role } })),
    onSuccess: async (data) => {
      show({
        name: data.item.name,
        url: linkUrl(data.link.token),
        expiresAt: data.link.expiresAt,
        invited: true,
      })
      setName('')
      setEmail('')
      setRole('editor')
      await refresh()
    },
  })
  const reissue = useMutation({
    mutationFn: (id: number) => unwrap(api.users[':id'].link.$post({ param: { id: String(id) } })),
    onSuccess: async (data) => {
      show({
        name: data.item.name,
        url: linkUrl(data.link.token),
        expiresAt: data.link.expiresAt,
        invited: false,
      })
      await refresh()
    },
  })
  const changeRole = useMutation({
    mutationFn: (input: { id: number; role: UserRole }) =>
      unwrap(
        api.users[':id'].$patch({ param: { id: String(input.id) }, json: { role: input.role } }),
      ),
    onSuccess: (_data, input) => {
      // No longer an administrator: this screen and the admin-only menu items
      // are gone, so start over from the dashboard with a fresh session state.
      if (input.id === me.id && input.role !== 'admin') {
        window.location.assign(toAdminHref('/'))
      }
    },
    onSettled: async () => {
      setSteppingDown(false)
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () =>
      removing
        ? unwrap(
            api.users[':id'].$delete({
              param: { id: String(removing.id) },
              query: reassignTo ? { reassignTo } : {},
            }),
          )
        : Promise.reject(new Error('削除対象がありません')),
    // Also on failure: the reason is shown on the page, behind the dialog.
    onSettled: async () => {
      setRemoving(null)
      setReassignTo('')
      await refresh()
    },
  })
  /** One message at a time: an earlier failure must not linger next to a later success. */
  const clearErrors = () => {
    invite.reset()
    reissue.reset()
    changeRole.reset()
    remove.reset()
  }

  if (!enabled)
    return (
      <div>
        <PageHeading title="ユーザー" />
        <div className="mt-6">
          <Alert tone="error">権限がありません</Alert>
        </div>
      </div>
    )

  const error = invite.error ?? reissue.error ?? changeRole.error ?? remove.error
  const items = users.data?.items ?? []

  return (
    <div>
      <PageHeading
        title="ユーザー"
        description="管理画面にログインできる人を追加します。パスワードはなく、相手は登録リンクからパスキーを作ります。"
      />

      {issued && (
        <div className="mt-6">
          <Alert tone="success">
            <p className="font-medium">
              {issued.invited
                ? `${issued.name} さんを追加しました。次の登録リンクを本人に渡してください。`
                : `${issued.name} さんの登録リンクを発行しました。本人に渡してください。`}
            </p>
            <code className="mt-3 block overflow-x-auto border border-green-300 bg-white p-3 text-xs">
              {issued.url}
            </code>
            <p className="mt-2 text-xs">
              {formatDateTime.format(new Date(issued.expiresAt))} まで有効で、1
              回だけ使えます。このリンクは再表示できません
              (なくした場合は「リンクを再発行」で作り直せます)。
            </p>
            <Button
              type="button"
              size="small"
              variant="secondary"
              className="mt-3"
              onClick={() => {
                void navigator.clipboard.writeText(issued.url)
                setCopied(true)
              }}
            >
              {copied ? 'コピーしました' : 'リンクをコピー'}
            </Button>
          </Alert>
        </div>
      )}
      {error && (
        <div className="mt-6">
          <Alert tone="error">{errorMessage(error)}</Alert>
        </div>
      )}

      <form
        className="mt-6 grid gap-4 border border-neutral-200 bg-white p-5 sm:grid-cols-[1fr_1fr_10rem_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          setIssued(null)
          clearErrors()
          invite.mutate()
        }}
      >
        <Field label="名前">
          <input
            className={inputClass}
            value={name}
            required
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="メールアドレス">
          <input
            className={inputClass}
            type="email"
            value={email}
            required
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="権限">
          <select
            className={inputClass}
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            <option value="editor">{roleLabels.editor}</option>
            <option value="admin">{roleLabels.admin}</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? '追加中…' : 'ユーザーを追加'}
          </Button>
        </div>
      </form>
      <p className="mt-2 text-xs leading-5 text-neutral-600">
        編集者はコンテンツ (固定ページ・投稿・メディア・フォームなど)
        を編集できます。設定・ユーザー・API キー・サンプルサイトは管理者だけが扱えます。
      </p>

      <div className="mt-6 overflow-x-auto border border-neutral-200 bg-white">
        <table className="w-full min-w-3xl text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3 font-medium">名前</th>
              <th className="px-4 py-3 font-medium">メールアドレス</th>
              <th className="px-4 py-3 font-medium">権限</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-medium">
                  {item.name}
                  {item.id === me.id && (
                    <span className="ml-2 text-xs text-neutral-500">(自分)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-600">{item.email}</td>
                <td className="px-4 py-3">
                  <select
                    className="border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                    aria-label={`${item.name} の権限`}
                    value={item.role}
                    disabled={changeRole.isPending}
                    onChange={(event) => {
                      const next = event.target.value as UserRole
                      clearErrors()
                      // Giving up your own administrator role cannot be undone by yourself.
                      if (item.id === me.id && next === 'editor') setSteppingDown(true)
                      else changeRole.mutate({ id: item.id, role: next })
                    }}
                  >
                    <option value="editor">{roleLabels.editor}</option>
                    <option value="admin">{roleLabels.admin}</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {item.passkeys > 0
                    ? `パスキー ${item.passkeys} 個`
                    : item.linkExpiresAt
                      ? `登録待ち (${formatDateTime.format(new Date(item.linkExpiresAt))} まで)`
                      : '未登録 (リンクの期限切れ)'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="small"
                      variant="secondary"
                      disabled={reissue.isPending}
                      onClick={() => {
                        setIssued(null)
                        clearErrors()
                        reissue.mutate(item.id)
                      }}
                    >
                      リンクを再発行
                    </Button>
                    {item.id !== me.id && (
                      <Button
                        type="button"
                        size="small"
                        variant="danger"
                        onClick={() => {
                          setReassignTo('')
                          clearErrors()
                          setRemoving({ id: item.id, name: item.name })
                        }}
                      >
                        削除
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="ユーザーを削除"
        description={`${removing?.name ?? ''} さんを削除します。この人はログインできなくなります。元に戻せません。`}
        confirmLabel="削除"
        pending={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate()}
      >
        <Field
          label="この人の投稿の著者"
          hint="引き継ぐ人を選ばなければ、投稿は残り、著者だけが空になります。"
        >
          <select
            className={inputClass}
            value={reassignTo}
            onChange={(event) => setReassignTo(event.target.value)}
          >
            <option value="">著者なしにする</option>
            {items
              .filter((item) => item.id !== removing?.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} に引き継ぐ
                </option>
              ))}
          </select>
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={steppingDown}
        title="自分を編集者にする"
        description="編集者になると、設定・ユーザー・API キーの画面を開けなくなります。管理者に戻すには、ほかの管理者に変更してもらう必要があります。"
        confirmLabel="編集者にする"
        pending={changeRole.isPending}
        onClose={() => setSteppingDown(false)}
        onConfirm={() => changeRole.mutate({ id: me.id, role: 'editor' })}
      />
    </div>
  )
}
