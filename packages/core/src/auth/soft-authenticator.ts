/**
 * A software WebAuthn authenticator for tests (unit tests and E2E API calls).
 * It answers the same JSON options the admin passes to `navigator.credentials`
 * and returns what `PublicKeyCredential.toJSON()` would. Never used at runtime.
 */
import type {
  AuthenticationCredential,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  RegistrationCredential,
} from '@kanso/shared'
import { concatBytes, fromBase64Url, randomBytes, sha256, toBase64Url, utf8 } from './encoding.ts'

type CborInput = number | string | Uint8Array | Map<number | string, CborInput>

function cborHead(major: number, value: number): Uint8Array {
  if (value < 24) return Uint8Array.of((major << 5) | value)
  if (value < 0x100) return Uint8Array.of((major << 5) | 24, value)
  if (value < 0x10000) return Uint8Array.of((major << 5) | 25, value >> 8, value & 0xff)
  return Uint8Array.of(
    (major << 5) | 26,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  )
}

export function encodeCbor(value: CborInput): Uint8Array<ArrayBuffer> {
  if (typeof value === 'number') {
    return concatBytes(value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value))
  }
  if (typeof value === 'string') {
    const bytes = utf8(value)
    return concatBytes(cborHead(3, bytes.length), bytes)
  }
  if (value instanceof Uint8Array) return concatBytes(cborHead(2, value.length), value)
  const parts: Uint8Array[] = [cborHead(5, value.size)]
  for (const [key, item] of value) parts.push(encodeCbor(key), encodeCbor(item))
  return concatBytes(...parts)
}

function p1363ToDer(signature: Uint8Array): Uint8Array<ArrayBuffer> {
  const integer = (bytes: Uint8Array) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1
    let value = bytes.slice(start)
    if ((value[0] ?? 0) & 0x80) value = concatBytes(Uint8Array.of(0), value)
    return concatBytes(Uint8Array.of(0x02, value.length), value)
  }
  const body = concatBytes(integer(signature.slice(0, 32)), integer(signature.slice(32)))
  return concatBytes(Uint8Array.of(0x30, body.length), body)
}

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_AT = 0x40

export type SoftAuthenticatorOptions = {
  algorithm?: -7 | -257
  /** A fixed ES256 private key (JWK with `d`), e.g. a test fixture shared across runs. */
  privateKey?: JsonWebKey
  /** Fixed credential id (base64url). Random by default. */
  credentialId?: string
  /** First counter value. Counters stay at 0 when this is 0, like synced passkeys. */
  signCount?: number
}

/** Fields a test can falsify to check that verification rejects them. */
export type CeremonyOverrides = {
  origin?: string
  rpId?: string
  challenge?: string
  type?: string
  userVerified?: boolean
  signCount?: number
}

export class SoftAuthenticator {
  /** User handle (base64url) remembered from registration, as a resident key would. */
  userHandle: string | null = null
  readonly algorithm: -7 | -257
  readonly credentialId: string
  private readonly keys: { privateKey: CryptoKey; publicKey: JsonWebKey }
  private signCount: number

  // Plain fields instead of parameter properties: E2E helpers and smoke
  // scripts load this file with Node's type stripping, which rejects them.
  private constructor(
    algorithm: -7 | -257,
    keys: { privateKey: CryptoKey; publicKey: JsonWebKey },
    credentialId: string,
    signCount: number,
  ) {
    this.algorithm = algorithm
    this.keys = keys
    this.credentialId = credentialId
    this.signCount = signCount
  }

  static async create(options: SoftAuthenticatorOptions = {}): Promise<SoftAuthenticator> {
    const algorithm = options.algorithm ?? -7
    const credentialId = options.credentialId ?? toBase64Url(randomBytes(32))
    const signCount = options.signCount ?? 0

    if (options.privateKey) {
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        options.privateKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      )
      const { d: _d, key_ops: _ops, ...publicKey } = options.privateKey
      return new SoftAuthenticator(algorithm, { privateKey, publicKey }, credentialId, signCount)
    }

    const pair = (await crypto.subtle.generateKey(
      algorithm === -7
        ? { name: 'ECDSA', namedCurve: 'P-256' }
        : {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: Uint8Array.of(1, 0, 1),
            hash: 'SHA-256',
          },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    const publicKey = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
    return new SoftAuthenticator(
      algorithm,
      { privateKey: pair.privateKey, publicKey },
      credentialId,
      signCount,
    )
  }

  private coseKey(): Map<number, CborInput> {
    const field = (value: string | undefined) => fromBase64Url(value ?? '') ?? new Uint8Array()
    const jwk = this.keys.publicKey
    if (this.algorithm === -7) {
      return new Map<number, CborInput>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, field(jwk.x)],
        [-3, field(jwk.y)],
      ])
    }
    return new Map<number, CborInput>([
      [1, 3],
      [3, -257],
      [-1, field(jwk.n)],
      [-2, field(jwk.e)],
    ])
  }

  private nextCount(override?: number): number {
    if (override !== undefined) return override
    if (this.signCount === 0) return 0
    this.signCount += 1
    return this.signCount
  }

  private async authData(rpId: string, flags: number, signCount: number, attested?: Uint8Array) {
    const count = new Uint8Array(4)
    new DataView(count.buffer).setUint32(0, signCount)
    return concatBytes(
      await sha256(utf8(rpId)),
      Uint8Array.of(flags),
      count,
      attested ?? new Uint8Array(),
    )
  }

  private clientData(type: string, challenge: string, origin: string) {
    return utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  }

  async register(
    options: PasskeyCreationOptions,
    origin: string,
    overrides: CeremonyOverrides = {},
  ): Promise<RegistrationCredential> {
    const rawId = fromBase64Url(this.credentialId) ?? new Uint8Array()
    const idLength = Uint8Array.of(rawId.length >> 8, rawId.length & 0xff)
    const attested = concatBytes(new Uint8Array(16), idLength, rawId, encodeCbor(this.coseKey()))
    const uv = overrides.userVerified === false ? 0 : FLAG_UV
    const authData = await this.authData(
      overrides.rpId ?? options.rp.id,
      FLAG_UP | uv | FLAG_AT,
      this.nextCount(overrides.signCount),
      attested,
    )
    const attestationObject = encodeCbor(
      new Map<string, CborInput>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    )
    this.userHandle = options.user.id
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: toBase64Url(
          this.clientData(
            overrides.type ?? 'webauthn.create',
            overrides.challenge ?? options.challenge,
            overrides.origin ?? origin,
          ),
        ),
        attestationObject: toBase64Url(attestationObject),
        transports: ['internal'],
      },
      authenticatorAttachment: 'platform',
    }
  }

  async authenticate(
    options: PasskeyRequestOptions,
    origin: string,
    overrides: CeremonyOverrides = {},
  ): Promise<AuthenticationCredential> {
    const uv = overrides.userVerified === false ? 0 : FLAG_UV
    const authData = await this.authData(
      overrides.rpId ?? options.rpId,
      FLAG_UP | uv,
      this.nextCount(overrides.signCount),
    )
    const clientDataJSON = this.clientData(
      overrides.type ?? 'webauthn.get',
      overrides.challenge ?? options.challenge,
      overrides.origin ?? origin,
    )
    const signed = concatBytes(authData, await sha256(clientDataJSON))
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        this.algorithm === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
        this.keys.privateKey,
        signed,
      ),
    )
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: toBase64Url(clientDataJSON),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(this.algorithm === -7 ? p1363ToDer(raw) : raw),
        userHandle: this.userHandle,
      },
      authenticatorAttachment: 'platform',
    }
  }
}
