import { PASSKEY_LIMIT, type PasskeySummary } from '@kanso/shared'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../api/client.ts'
import { ApiError, fieldErrors } from '../../../api/errors.ts'
import { passkeysQuery, profileQuery } from '../../../api/queries.ts'
import { unwrap } from '../../../api/request.ts'
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx'
import { SaveBar } from '../../../components/editing/SaveBar.tsx'
import { useEditorSave } from '../../../components/editing/useEditorSave.ts'
import { SlugField, TextareaField } from '../../../components/fields.tsx'
import { MediaField } from '../../../components/media/MediaField.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'
import { Alert, Button, inputClass } from '../../../components/ui.tsx'
import {
  createPasskey,
  defaultPasskeyName,
  passkeyErrorMessage,
  passkeysSupported,
} from '../../../lib/passkey.ts'

export const Route = createFileRoute('/_auth/account/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(passkeysQuery),
      context.queryClient.ensureQueryData(profileQuery),
    ]),
  component: AccountPage,
})

const ROLE_LABELS = { admin: '管理者', editor: '編集者' } as const

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '未使用'
}

function AccountPage() {
  const { user } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const passkeys = useQuery(passkeysQuery)
  const items = passkeys.data?.items ?? []
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [deleting, setDeleting] = useState<PasskeySummary | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey })

  const add = useMutation({
    mutationFn: async () => {
      const { options } = await unwrap(api.auth.passkeys.options.$post())
      const credential = await createPasskey(options)
      return unwrap(api.auth.passkeys.$post({ json: { credential, name: defaultPasskeyName() } }))
    },
    onSuccess: async (data) => {
      setNotice(`パスキー「${data.item.name}」を追加しました。`)
      await refresh()
    },
  })
  const rename = useMutation({
    mutationFn: (input: { id: number; name: string }) =>
      unwrap(
        api.auth.passkeys[':id'].$patch({
          param: { id: String(input.id) },
          json: { name: input.name },
        }),
      ),
    onSuccess: async () => {
      setEditing(null)
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) =>
      unwrap(api.auth.passkeys[':id'].$delete({ param: { id: String(id) } })),
    onSuccess: async () => {
      setNotice(`パスキー「${deleting?.name ?? ''}」を削除しました。`)
      setDeleting(null)
      await refresh()
    },
  })
  const error = add.error ?? rename.error ?? remove.error

  return (
    <div>
      <PageHeading title="アカウント" description="ログインに使うパスキーを管理します。" />

      <dl className="mt-6 grid gap-4 border border-neutral-200 bg-white p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-neutral-500">名前</dt>
          <dd className="mt-1 font-medium">{user.name}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">メールアドレス</dt>
          <dd className="mt-1 font-medium break-all">{user.email}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">権限</dt>
          <dd className="mt-1 font-medium">{ROLE_LABELS[user.role]}</dd>
        </div>
      </dl>

      <AuthorProfileForm />

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">パスキー</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600">
              パソコンとスマートフォンなど、複数の端末で登録しておくと、1
              台をなくしてもログインできます (最大 {PASSKEY_LIMIT} 個)。
            </p>
          </div>
          <Button
            type="button"
            disabled={!passkeysSupported() || add.isPending || items.length >= PASSKEY_LIMIT}
            onClick={() => {
              setNotice(null)
              add.mutate()
            }}
          >
            {add.isPending ? '作成中…' : 'パスキーを追加'}
          </Button>
        </div>

        {notice && !error && (
          <div className="mt-4">
            <Alert tone="success">{notice}</Alert>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <Alert tone="error">{passkeyErrorMessage(error)}</Alert>
          </div>
        )}
        {items.length === 1 && (
          <div className="mt-4">
            <Alert tone="info">
              パスキーが 1
              つだけです。この端末をなくすとログインできなくなるため、別の端末でもパスキーを追加しておくことをおすすめします。
            </Alert>
          </div>
        )}

        <div className="mt-4 overflow-x-auto border border-neutral-200 bg-white">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-4 py-3 font-medium">名前</th>
                <th className="px-4 py-3 font-medium">種類</th>
                <th className="px-4 py-3 font-medium">登録日時</th>
                <th className="px-4 py-3 font-medium">最終使用</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium">
                    {editing?.id === item.id ? (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault()
                          rename.mutate(editing)
                        }}
                      >
                        <input
                          aria-label="パスキーの名前"
                          className={`${inputClass} mt-0`}
                          value={editing.name}
                          required
                          maxLength={100}
                          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                        />
                        <Button type="submit" size="small" disabled={rename.isPending}>
                          保存
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="secondary"
                          onClick={() => setEditing(null)}
                        >
                          取消
                        </Button>
                      </form>
                    ) : (
                      item.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {item.backedUp ? '同期されるパスキー' : 'この端末だけ'}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{formatDate(item.createdAt)}</td>
                  <td className="px-4 py-3 text-neutral-600">{formatDate(item.lastUsedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => setEditing({ id: item.id, name: item.name })}
                      >
                        名前を変更
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="danger"
                        disabled={items.length <= 1}
                        title={items.length <= 1 ? '最後のパスキーは削除できません' : undefined}
                        onClick={() => setDeleting(item)}
                      >
                        削除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="パスキーを削除"
        description={`「${deleting?.name ?? ''}」を削除すると、そのパスキーではログインできなくなります。`}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
function AuthorProfileForm() {
  const { data: initial } = useSuspenseQuery(profileQuery)
  const queryClient = useQueryClient()
  const [profile, setProfile] = useState(initial)
  const [previous, setPrevious] = useState(initial)
  const save = useEditorSave({
    value: profile,
    onSave: async (value) => {
      // Send only changed fields so an avatar or bio saved from another tab survives.
      const { profile: updated } = await unwrap(
        api.auth.profile.$patch({
          json: {
            ...(value.slug !== previous.slug && value.slug ? { slug: value.slug } : {}),
            ...(value.bio !== previous.bio ? { bio: value.bio } : {}),
            ...(value.avatarMediaId !== previous.avatarMediaId
              ? { avatarMediaId: value.avatarMediaId }
              : {}),
          },
        }),
      )
      setPrevious(value)
      queryClient.setQueryData(profileQuery.queryKey, updated)
      return {
        value: updated,
        apply: () => {
          setProfile(updated)
          setPrevious(updated)
        },
      }
    },
  })
  const errors = fieldErrors(save.error)
  if (save.error instanceof ApiError && save.error.message === 'Author slug already exists') {
    errors.slug = 'この著者スラッグは使用されています。別のスラッグを入力してください。'
  }
  return (
    <section className="mt-8">
      <h2 id="author-profile-title" className="text-lg font-semibold">
        著者プロフィール
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600">
        著者アーカイブページ（/{'{type}'}/author/{'{slug}'}
        ）に表示される情報です。投稿の著者名からリンクされます。
      </p>
      <form
        ref={save.formRef}
        aria-labelledby="author-profile-title"
        className="mt-4 grid max-w-2xl gap-5 border border-neutral-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void save.submit()
        }}
      >
        <SaveBar save={save} label="プロフィールを保存" error={Object.values(errors)[0]} />
        <SlugField
          label="著者スラッグ"
          name="slug"
          hint="著者アーカイブの URL 末尾です。小文字・数字・ハイフンのみ。"
          value={profile.slug ?? ''}
          required={previous.slug !== null}
          maxLength={120}
          error={errors.slug}
          onChange={(event) => setProfile({ ...profile, slug: event.target.value || null })}
        />
        <TextareaField
          label="プロフィール文 (bio)"
          name="bio"
          rows={4}
          maxLength={1000}
          showCount
          value={profile.bio ?? ''}
          error={errors.bio}
          onChange={(event) => setProfile({ ...profile, bio: event.target.value || null })}
        />
        <MediaField
          label="アバター画像"
          error={errors.avatarMediaId}
          value={profile.avatarMediaId}
          onChange={(avatarMediaId) => setProfile({ ...profile, avatarMediaId })}
        />
      </form>
    </section>
  )
}
