import logo from '../assets/brand/kanso-logo.svg'
import mark from '../assets/brand/kanso-mark.svg'

export function BrandLogo({
  markOnly = false,
  className = 'h-9 w-36',
}: {
  markOnly?: boolean
  className?: string
}) {
  return (
    <img
      src={markOnly ? mark : logo}
      alt="kansoCMS"
      width={markOnly ? 64 : 256}
      height={64}
      className={`shrink-0 ${className}`}
    />
  )
}
