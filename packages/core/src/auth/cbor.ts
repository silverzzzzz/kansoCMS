/**
 * Minimal CBOR (RFC 8949) decoder for WebAuthn: attestation objects, COSE keys
 * and authenticator extensions. Authenticators emit definite-length CTAP2
 * canonical CBOR, so indefinite lengths, tags and floats are rejected rather
 * than supported.
 */

export type CborValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | Uint8Array<ArrayBuffer>
  | CborValue[]
  | CborMap

export type CborMap = Map<number | string, CborValue>

const MAX_DEPTH = 16

export class CborError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CborError'
  }
}

/** Decodes exactly one item that must span the whole input. */
export function decodeCbor(bytes: Uint8Array<ArrayBuffer>): CborValue {
  const { value, end } = decodeCborPrefix(bytes, 0)
  if (end !== bytes.length) throw new CborError('Trailing bytes after CBOR item')
  return value
}

/** Decodes one item starting at `offset` and reports where it ended. */
export function decodeCborPrefix(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
): { value: CborValue; end: number } {
  const reader = new Reader(bytes, offset)
  const value = reader.item(0)
  return { value, end: reader.offset }
}

class Reader {
  constructor(
    private readonly bytes: Uint8Array<ArrayBuffer>,
    public offset: number,
  ) {}

  item(depth: number): CborValue {
    if (depth > MAX_DEPTH) throw new CborError('CBOR nesting is too deep')
    const initial = this.byte()
    const major = initial >> 5
    const info = initial & 0x1f

    if (major === 7) {
      if (info === 20) return false
      if (info === 21) return true
      if (info === 22) return null
      if (info === 23) return undefined
      throw new CborError('Unsupported CBOR simple value or float')
    }

    const argument = this.argument(info)
    switch (major) {
      case 0:
        return argument
      case 1:
        return -1 - argument
      case 2:
        return this.take(argument)
      case 3:
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
          this.take(argument),
        )
      case 4: {
        const items: CborValue[] = []
        for (let index = 0; index < argument; index += 1) items.push(this.item(depth + 1))
        return items
      }
      case 5: {
        const map: CborMap = new Map()
        for (let index = 0; index < argument; index += 1) {
          const key = this.item(depth + 1)
          if (typeof key !== 'number' && typeof key !== 'string') {
            throw new CborError('CBOR map keys must be integers or strings')
          }
          if (map.has(key)) throw new CborError('Duplicate CBOR map key')
          map.set(key, this.item(depth + 1))
        }
        return map
      }
      default:
        throw new CborError('CBOR tags are not supported')
    }
  }

  private argument(info: number): number {
    if (info < 24) return info
    if (info === 24) return this.byte()
    if (info === 25) return this.uint(2)
    if (info === 26) return this.uint(4)
    if (info === 27) {
      const value = this.uint(8)
      if (!Number.isSafeInteger(value)) throw new CborError('CBOR integer is too large')
      return value
    }
    throw new CborError('Indefinite-length CBOR is not supported')
  }

  private uint(length: number): number {
    let value = 0
    for (let index = 0; index < length; index += 1) value = value * 256 + this.byte()
    return value
  }

  private byte(): number {
    const value = this.bytes[this.offset]
    if (value === undefined) throw new CborError('Unexpected end of CBOR input')
    this.offset += 1
    return value
  }

  private take(length: number): Uint8Array<ArrayBuffer> {
    if (length > this.bytes.length - this.offset) throw new CborError('CBOR length exceeds input')
    const out = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return out
  }
}
