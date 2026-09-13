const ALGORITHM = 'PBKDF2'
const HASH = 'SHA-256'
const ITERATIONS = 100_000
const SALT_BYTES = 16
const HASH_BYTES = 32
const PREFIX = 'pbkdf2-sha256'
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL_PATTERN.test(value)) return null

  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), ALGORITHM, false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: ALGORITHM, hash: HASH, salt, iterations: ITERATIONS },
    key,
    HASH_BYTES * 8,
  )
  return new Uint8Array(bits)
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false

  let difference = 0
  for (const [index, leftByte] of left.entries()) {
    difference |= leftByte ^ (right[index] ?? 0)
  }
  return difference === 0
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_BYTES)))
  const hash = await derive(password, salt)
  return `${PREFIX}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== PREFIX || parts[1] !== String(ITERATIONS)) {
    return false
  }

  const salt = fromBase64Url(parts[2] ?? '')
  const expected = fromBase64Url(parts[3] ?? '')
  if (salt?.length !== SALT_BYTES || expected?.length !== HASH_BYTES) return false

  const actual = await derive(password, salt)
  return constantTimeEqual(actual, expected)
}

export function generateToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(bytes))))
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(HASH, encoder.encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
