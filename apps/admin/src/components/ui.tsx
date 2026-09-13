import type { ButtonHTMLAttributes, ReactNode } from 'react'

export const inputClass =
  'mt-2 block w-full border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none ' +
  'focus:border-neutral-950 focus:ring-1 focus:ring-neutral-950 disabled:bg-neutral-100 sm:text-sm'

const buttonVariants = {
  primary: 'border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-800',
  secondary: 'border-neutral-300 bg-white text-neutral-800 hover:border-neutral-950',
  danger: 'border-red-700 bg-red-700 text-white hover:bg-red-800',
} as const

export function Button({
  variant = 'primary',
  size = 'normal',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants
  size?: 'small' | 'normal'
}) {
  return (
    <button
      className={`border font-medium outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${size === 'small' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'} ${className}`}
      {...props}
    />
  )
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the form control is supplied as children.
    <label className="block text-sm font-medium text-neutral-800">
      {label}
      {children}
      {hint && (
        <span className="mt-1 block text-xs font-normal leading-5 text-neutral-500">{hint}</span>
      )}
      {error && (
        <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
          {error}
        </span>
      )}
    </label>
  )
}

const alertTones = {
  error: 'border-red-600 bg-red-50 text-red-800',
  success: 'border-green-700 bg-green-50 text-green-900',
  info: 'border-neutral-500 bg-neutral-50 text-neutral-800',
} as const

export function Alert({ tone, children }: { tone: keyof typeof alertTones; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`border-l-2 p-3 text-sm ${alertTones[tone]}`}
    >
      {children}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600">
      {children}
    </div>
  )
}
