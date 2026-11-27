import { type MenuFields, type MenuItem, slugify } from '@kanso/shared'
import { useId, useRef, useState } from 'react'
import { fieldErrors } from '../api/errors.ts'
import { SaveBar } from './editing/SaveBar.tsx'
import { useEditorSave } from './editing/useEditorSave.ts'
import { SlugField, TextField } from './fields.tsx'
import { inputClass } from './ui.tsx'

const smallButtonClass =
  'border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-950'

/** Position-aligned React keys so reorders keep component state without index keys. */
type ItemKeys = { self: string; children: string[] }

export function MenuForm({
  initial,
  onSave,
  initialSaved = false,
}: {
  initial?: MenuFields
  initialSaved?: boolean
  onSave: (input: MenuFields) => Promise<void | (() => Promise<void>)>
}) {
  const [draft, setDraft] = useState<MenuFields>(() => initial ?? { name: '', slug: '', items: [] })
  const [manualSlug, setManualSlug] = useState(Boolean(initial))
  const save = useEditorSave({ value: draft, onSave, initialSaved, isNew: !initial })
  const errors = fieldErrors(save.error)
  const { items } = draft
  const onItems = (items: MenuItem[]) => setDraft((current) => ({ ...current, items }))
  const counter = useRef(0)
  const keysRef = useRef<ItemKeys[]>([])
  const keys = keysRef.current

  const newKey = () => `item-${counter.current++}`
  while (keys.length < items.length) {
    keys.push({
      self: newKey(),
      children: (items[keys.length]?.children ?? []).map(() => newKey()),
    })
  }

  const updateItem = (index: number, patch: Partial<MenuItem>) =>
    onItems(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    if (!moved) return
    next.splice(target, 0, moved)
    const [movedKey] = keys.splice(index, 1)
    if (movedKey) keys.splice(target, 0, movedKey)
    onItems(next)
  }

  const removeItem = (index: number) => {
    keys.splice(index, 1)
    onItems(items.filter((_, i) => i !== index))
  }

  const addItem = () => {
    keys.push({ self: newKey(), children: [] })
    onItems([...items, { label: '', href: '/', children: [] }])
  }

  const updateChildren = (
    index: number,
    children: MenuItem['children'],
    spliceKey?: () => void,
  ) => {
    spliceKey?.()
    updateItem(index, { children })
  }

  const id = useId()
  function itemValidity(path: string) {
    return errors[path]
      ? ({ 'aria-invalid': true, 'aria-describedby': `${id}-${path}` } as const)
      : {}
  }
  const itemErrors = Object.entries(errors).filter(([key]) => key.startsWith('items'))

  return (
    <form
      ref={save.formRef}
      className="mt-6 space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save.submit()
      }}
    >
      <SaveBar save={save} error={Object.values(errors)[0]} />
      <fieldset
        disabled={!initial && save.pending}
        className="min-w-0 space-y-5 border border-neutral-200 bg-white p-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="名前"
            error={errors.name}
            value={draft.name}
            required
            placeholder="ヘッダーナビ"
            onChange={(event) => {
              const name = event.target.value
              setDraft((current) => ({
                ...current,
                name,
                slug: manualSlug ? current.slug : slugify(name),
              }))
            }}
          />
          <SlugField
            label="スラッグ"
            error={errors.slug}
            hint="半角の英小文字・数字・ハイフンで入力します。header にするとサイトのナビゲーションに使われます。"
            value={draft.slug}
            required
            placeholder="header"
            onChange={(event) => {
              setManualSlug(true)
              setDraft({ ...draft, slug: event.target.value })
            }}
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-800">メニュー項目</p>
            <button type="button" className={smallButtonClass} onClick={addItem}>
              + 項目を追加
            </button>
          </div>
          {itemErrors.length > 0 && (
            <ul className="mb-3 space-y-1" role="alert">
              {itemErrors.map(([key, message]) => (
                <li key={key} id={`${id}-${key}`} className="text-xs text-red-700">
                  {key}: {message}
                </li>
              ))}
            </ul>
          )}
          {items.length === 0 ? (
            <p className="border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
              項目がありません。「項目を追加」でラベルとリンク先を登録します。
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((item, index) => {
                const itemKey = keys[index]
                if (!itemKey) return null
                return (
                  <li key={itemKey.self} className="border border-neutral-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className={`${inputClass} mt-0 w-40`}
                        {...itemValidity(`items.${index}.label`)}
                        value={item.label}
                        required
                        placeholder="ラベル"
                        aria-label={`項目 ${index + 1} のラベル`}
                        onChange={(event) => updateItem(index, { label: event.target.value })}
                      />
                      <input
                        className={`${inputClass} mt-0 min-w-48 flex-1`}
                        {...itemValidity(`items.${index}.href`)}
                        value={item.href}
                        required
                        placeholder="/path または https://…"
                        aria-label={`項目 ${index + 1} のリンク先`}
                        onChange={(event) => updateItem(index, { href: event.target.value })}
                      />
                      <button
                        type="button"
                        className={smallButtonClass}
                        disabled={index === 0}
                        onClick={() => moveItem(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={smallButtonClass}
                        disabled={index === items.length - 1}
                        onClick={() => moveItem(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={smallButtonClass}
                        onClick={() =>
                          updateChildren(index, [...item.children, { label: '', href: '/' }], () =>
                            itemKey.children.push(newKey()),
                          )
                        }
                      >
                        + 子項目
                      </button>
                      <button
                        type="button"
                        className={`${smallButtonClass} text-red-700`}
                        onClick={() => removeItem(index)}
                      >
                        削除
                      </button>
                    </div>
                    {item.children.length > 0 && (
                      <ul className="mt-2 space-y-2 border-l-2 border-neutral-200 pl-4">
                        {item.children.map((child, childIndex) => {
                          const childKey = itemKey.children[childIndex]
                          if (!childKey) return null
                          return (
                            <li key={childKey} className="flex flex-wrap items-center gap-2">
                              <input
                                className={`${inputClass} mt-0 w-40`}
                                {...itemValidity(`items.${index}.children.${childIndex}.label`)}
                                value={child.label}
                                required
                                placeholder="子ラベル"
                                aria-label={`項目 ${index + 1}-${childIndex + 1} のラベル`}
                                onChange={(event) =>
                                  updateChildren(
                                    index,
                                    item.children.map((c, i) =>
                                      i === childIndex ? { ...c, label: event.target.value } : c,
                                    ),
                                  )
                                }
                              />
                              <input
                                className={`${inputClass} mt-0 min-w-48 flex-1`}
                                {...itemValidity(`items.${index}.children.${childIndex}.href`)}
                                value={child.href}
                                required
                                placeholder="/path または https://…"
                                aria-label={`項目 ${index + 1}-${childIndex + 1} のリンク先`}
                                onChange={(event) =>
                                  updateChildren(
                                    index,
                                    item.children.map((c, i) =>
                                      i === childIndex ? { ...c, href: event.target.value } : c,
                                    ),
                                  )
                                }
                              />
                              <button
                                type="button"
                                className={`${smallButtonClass} text-red-700`}
                                onClick={() =>
                                  updateChildren(
                                    index,
                                    item.children.filter((_, i) => i !== childIndex),
                                    () => itemKey.children.splice(childIndex, 1),
                                  )
                                }
                              >
                                削除
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </fieldset>
    </form>
  )
}
