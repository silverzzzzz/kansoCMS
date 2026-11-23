import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { AdminNavigation, NavigationIcon } from './AdminNavigation.tsx'
import { BrandLogo } from './BrandLogo.tsx'

/** A separate mobile dialog keeps the desktop sidebar's landmark semantics intact. */
export function MobileNavigation({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const id = useId()
  const router = useRouter()

  // Wait for navigation to succeed, so unsaved-change guards still work as before.
  useEffect(() => router.subscribe('onResolved', () => setOpen(false)), [router])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return

    dialog.showModal()
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'

    // Both ends of the gesture must be on the backdrop, not a drag from the menu.
    let backdropPressed = false
    const onPointerDown = (event: PointerEvent) => {
      backdropPressed = event.target === dialog && event.button === 0
    }
    const onPointerUp = (event: PointerEvent) => {
      if (backdropPressed && event.target === dialog) setOpen(false)
      backdropPressed = false
    }
    const desktop = window.matchMedia('(min-width: 64rem)')
    const closeOnDesktop = () => {
      if (!desktop.matches) return
      dialog.close()
      setOpen(false)
      document.getElementById('admin-sidebar-toggle')?.focus()
    }
    dialog.addEventListener('pointerdown', onPointerDown)
    dialog.addEventListener('pointerup', onPointerUp)
    desktop.addEventListener('change', closeOnDesktop)
    closeOnDesktop()

    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown)
      dialog.removeEventListener('pointerup', onPointerUp)
      desktop.removeEventListener('change', closeOnDesktop)
      root.style.overflow = previousOverflow
      if (dialog.open) dialog.close()
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="メニューを開く"
        aria-expanded={open}
        aria-controls={id}
        className="flex size-11 shrink-0 items-center justify-center border border-neutral-300 text-neutral-700 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 lg:hidden"
      >
        <NavigationIcon name="menu" />
      </button>
      <dialog
        ref={dialogRef}
        id={id}
        aria-label="管理メニュー"
        onClose={() => setOpen(false)}
        className="admin-drawer"
      >
        <div className="admin-drawer-sheet">
          <div className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-neutral-200 px-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="メニューを閉じる"
              className="flex size-11 shrink-0 items-center justify-center text-neutral-700 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950"
            >
              <NavigationIcon name="close" />
            </button>
            <Link
              to="/"
              className="flex min-h-11 items-center outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-4"
            >
              <BrandLogo />
            </Link>
          </div>
          <AdminNavigation isAdmin={isAdmin} label="モバイル管理メニュー" />
          <p className="shrink-0 border-t border-neutral-200 px-6 py-4 text-xs leading-5 text-neutral-500">
            シンプルに書き、確実に届ける。
          </p>
        </div>
      </dialog>
    </>
  )
}
