import { useEffect, useId, useRef, useState } from 'react'

/** A disclosure of ordinary buttons. Tab follows their normal document order. */
export function MoreActions({
  label,
  disabled,
  actions,
}: {
  label: string
  disabled?: boolean
  actions: { label: string; run: () => void }[]
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const container = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return (
    <fieldset
      ref={container}
      aria-label={label}
      className="relative inline-flex"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          setOpen(false)
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault()
          trigger.current?.focus()
          setOpen(false)
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={id}
        className="min-h-9 min-w-9 border border-neutral-300 px-2 text-base font-semibold text-neutral-700 hover:border-neutral-950 hover:bg-neutral-50 disabled:opacity-50"
        onClick={() => setOpen(!open)}
      >
        …
      </button>
      <div
        id={id}
        hidden={!open}
        className="absolute right-0 top-full z-30 mt-1 w-max border border-neutral-300 bg-white p-1 shadow-md"
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100"
            onClick={() => {
              trigger.current?.focus()
              setOpen(false)
              action.run()
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
