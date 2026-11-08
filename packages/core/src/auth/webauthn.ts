/**
 * WebAuthn (passkey) ceremonies for the relying party side.
 *
 * Follows the checks of EmDash's passkey module (emdash-cms/emdash,
 * packages/auth/src/passkey, MIT) and the WebAuthn Level 3 verification
 * steps, but parses CBOR itself and verifies signatures with WebCrypto, so it
 * needs no dependencies and stays within the Workers CPU budget.
 */
import {
  type AuthenticationCredential,
  PASSKEY_CHALLENGE_TTL_SECONDS,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
  type RegistrationCredential,
} from '@kanso/shared'
import { KansoError } from '../errors.ts'
import { type CborMap, type CborValue, decodeCbor, decodeCborPrefix } from './cbor.ts'
import { bytesEqual, concatBytes, fromBase64Url, sha256, toBase64Url, utf8 } from './encoding.ts'

export const COSE_ES256 = -7
export const COSE_RS256 = -257

const KNOWN_TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_BS = 0x10
const FLAG_AT = 0x40
const FLAG_ED = 0x80
const MAX_CREDENTIAL_ID_BYTES = 1023
const MIN_RSA_MODULUS_BYTES = 256

export type RelyingParty = { id: string; name: string; origin: string }

/** What the server expects a ceremony response to be bound to. */
export type ExpectedCeremony = { challenge: string; rpId: string; origin: string }

export type VerifiedRegistration = {
  credentialId: string
  /** SubjectPublicKeyInfo (DER), base64url. */
  publicKey: string
  algorithm: number
  signCount: number
  backedUp: boolean
  transports: string[]
}

export type StoredPasskey = {
  credentialId: string
  publicKey: string
  algorithm: number
  signCount: number
}

function fail(reason: string): never {
  throw KansoError.unauthorized(`Passkey verification failed: ${reason}`)
}

function decode(value: string, what: string): Uint8Array<ArrayBuffer> {
  return fromBase64Url(value) ?? fail(`${what} is not base64url`)
}

/** The WebAuthn user handle of a user: the UTF-8 bytes of `users.webauthn_user_id`. */
export function userHandle(webauthnUserId: string): string {
  return toBase64Url(utf8(webauthnUserId))
}

export function creationOptions(input: {
  rp: { id: string; name: string }
  user: { webauthnUserId: string; email: string; name: string }
  challenge: string
  exclude: { credentialId: string; transports: string[] }[]
}): PasskeyCreationOptions {
  return {
    challenge: input.challenge,
    rp: { id: input.rp.id, name: input.rp.name },
    user: {
      id: userHandle(input.user.webauthnUserId),
      name: input.user.email,
      displayName: input.user.name,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: COSE_ES256 },
      { type: 'public-key', alg: COSE_RS256 },
    ],
    timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    excludeCredentials: input.exclude.map((item) => ({
      type: 'public-key',
      id: item.credentialId,
      ...(item.transports.length > 0 ? { transports: item.transports } : {}),
    })),
  }
}

/** Options for a username-less sign-in with any discoverable credential. */
export function requestOptions(input: { rpId: string; challenge: string }): PasskeyRequestOptions {
  return {
    challenge: input.challenge,
    rpId: input.rpId,
    timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
    userVerification: 'required',
    allowCredentials: [],
  }
}

type ClientData = { type: string; challenge: string; origin: string; crossOrigin: boolean }

function parseClientData(bytes: Uint8Array<ArrayBuffer>): ClientData {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
  } catch {
    fail('client data is not JSON')
  }
  if (typeof value !== 'object' || value === null) fail('client data is not an object')
  const data = value as Record<string, unknown>
  if (
    typeof data.type !== 'string' ||
    typeof data.challenge !== 'string' ||
    typeof data.origin !== 'string' ||
    (data.crossOrigin !== undefined && typeof data.crossOrigin !== 'boolean')
  ) {
    fail('client data is malformed')
  }
  return {
    type: data.type,
    challenge: data.challenge,
    origin: data.origin,
    crossOrigin: data.crossOrigin === true,
  }
}

/**
 * The challenge a response answers. Read first so the stored challenge (and
 * whatever it was issued for) can be looked up before full verification.
 */
export function readChallenge(clientDataJSON: string): string {
  return parseClientData(decode(clientDataJSON, 'client data')).challenge
}

function checkClientData(data: ClientData, type: string, expected: ExpectedCeremony): void {
  if (data.type !== type) fail('unexpected client data type')
  if (data.challenge !== expected.challenge) fail('challenge mismatch')
  if (data.origin !== expected.origin) fail('origin mismatch')
  if (data.crossOrigin) fail('cross-origin ceremonies are not allowed')
}

function checkCredentialId(id: string, rawId: string): Uint8Array<ArrayBuffer> {
  const bytes = decode(rawId, 'credential id')
  if (bytes.length === 0 || bytes.length > MAX_CREDENTIAL_ID_BYTES) fail('credential id length')
  if (toBase64Url(bytes) !== id) fail('credential id mismatch')
  return bytes
}

type AuthenticatorData = {
  userPresent: boolean
  userVerified: boolean
  backedUp: boolean
  signCount: number
  attested: { credentialId: Uint8Array<ArrayBuffer>; publicKey: CborMap } | null
}

function cborAt(bytes: Uint8Array<ArrayBuffer>, offset: number, what: string) {
  try {
    const { value, end } = decodeCborPrefix(bytes, offset)
    if (!(value instanceof Map)) fail(`${what} is not a CBOR map`)
    return { value, end }
  } catch (error) {
    if (error instanceof KansoError) throw error
    fail(`${what} is not valid CBOR`)
  }
}

async function parseAuthenticatorData(
  bytes: Uint8Array<ArrayBuffer>,
  rpId: string,
): Promise<AuthenticatorData> {
  if (bytes.length < 37) fail('authenticator data is too short')
  if (!bytesEqual(bytes.slice(0, 32), await sha256(utf8(rpId)))) fail('RP ID hash mismatch')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = view.getUint8(32)
  const signCount = view.getUint32(33)
  let offset = 37
  let attested: AuthenticatorData['attested'] = null

  if (flags & FLAG_AT) {
    if (bytes.length < offset + 18) fail('attested credential data is too short')
    offset += 16 // AAGUID: not used, attestation is not verified.
    const idLength = view.getUint16(offset)
    offset += 2
    if (idLength === 0 || idLength > MAX_CREDENTIAL_ID_BYTES || bytes.length < offset + idLength) {
      fail('credential id length')
    }
    const credentialId = bytes.slice(offset, offset + idLength)
    const key = cborAt(bytes, offset + idLength, 'credential public key')
    attested = { credentialId, publicKey: key.value }
    offset = key.end
  }
  if (flags & FLAG_ED) offset = cborAt(bytes, offset, 'extensions').end
  if (offset !== bytes.length) fail('trailing bytes in authenticator data')

  return {
    userPresent: (flags & FLAG_UP) !== 0,
    userVerified: (flags & FLAG_UV) !== 0,
    backedUp: (flags & FLAG_BS) !== 0,
    signCount,
    attested,
  }
}

function bytesField(key: CborMap, label: number): Uint8Array<ArrayBuffer> | null {
  const value = key.get(label)
  return value instanceof Uint8Array ? value : null
}

async function importOrFail(load: () => Promise<CryptoKey>): Promise<CryptoKey> {
  try {
    return await load()
  } catch {
    fail('credential public key is invalid')
  }
}

/** Converts a COSE_Key to SubjectPublicKeyInfo via WebCrypto (which also validates it). */
async function coseToSpki(key: CborMap): Promise<{ algorithm: number; spki: Uint8Array }> {
  const algorithm = key.get(3)
  const keyType = key.get(1)

  if (algorithm === COSE_ES256) {
    const x = bytesField(key, -2)
    const y = bytesField(key, -3)
    if (keyType !== 2 || key.get(-1) !== 1 || x?.length !== 32 || y?.length !== 32) {
      fail('ES256 keys must be EC2 P-256 keys')
    }
    const cryptoKey = await importOrFail(() =>
      crypto.subtle.importKey(
        'jwk',
        { kty: 'EC', crv: 'P-256', x: toBase64Url(x), y: toBase64Url(y), ext: true },
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      ),
    )
    return { algorithm, spki: new Uint8Array(await exportSpki(cryptoKey)) }
  }

  if (algorithm === COSE_RS256) {
    const modulus = bytesField(key, -1)
    const exponent = bytesField(key, -2)
    const n = modulus?.slice(
      Math.max(
        0,
        modulus.findIndex((byte) => byte !== 0),
      ),
    )
    if (keyType !== 3 || !n || n.length < MIN_RSA_MODULUS_BYTES || !exponent?.length) {
      fail('RS256 keys must be RSA keys of at least 2048 bits')
    }
    const cryptoKey = await importOrFail(() =>
      crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: toBase64Url(n), e: toBase64Url(exponent), alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        true,
        ['verify'],
      ),
    )
    return { algorithm, spki: new Uint8Array(await exportSpki(cryptoKey)) }
  }

  fail('unsupported credential algorithm')
}

async function exportSpki(key: CryptoKey): Promise<ArrayBuffer> {
  const exported = await crypto.subtle.exportKey('spki', key)
  if (!(exported instanceof ArrayBuffer)) fail('could not export the public key')
  return exported
}

export async function verifyRegistration(
  credential: RegistrationCredential,
  expected: ExpectedCeremony,
): Promise<VerifiedRegistration> {
  const rawId = checkCredentialId(credential.id, credential.rawId)
  const clientData = parseClientData(decode(credential.response.clientDataJSON, 'client data'))
  checkClientData(clientData, 'webauthn.create', expected)

  let attestation: CborValue
  try {
    attestation = decodeCbor(decode(credential.response.attestationObject, 'attestation object'))
  } catch (error) {
    if (error instanceof KansoError) throw error
    fail('attestation object is not valid CBOR')
  }
  if (!(attestation instanceof Map)) fail('attestation object is not a CBOR map')
  const authData = attestation.get('authData')
  if (
    typeof attestation.get('fmt') !== 'string' ||
    !(attestation.get('attStmt') instanceof Map) ||
    !(authData instanceof Uint8Array)
  ) {
    fail('attestation object is malformed')
  }
  // The attestation statement is not verified: the options ask for `none`, and
  // kansoCMS does not restrict which authenticator models may be used.

  const parsed = await parseAuthenticatorData(authData, expected.rpId)
  if (!parsed.userPresent) fail('user presence flag is not set')
  if (!parsed.userVerified) fail('user verification flag is not set')
  if (!parsed.attested) fail('no attested credential data')
  if (!bytesEqual(parsed.attested.credentialId, rawId)) fail('credential id mismatch')

  const { algorithm, spki } = await coseToSpki(parsed.attested.publicKey)
  return {
    credentialId: credential.id,
    publicKey: toBase64Url(spki),
    algorithm,
    signCount: parsed.signCount,
    backedUp: parsed.backedUp,
    transports: (credential.response.transports ?? []).filter((item) => KNOWN_TRANSPORTS.has(item)),
  }
}

/** DER `Ecdsa-Sig-Value` → the fixed-width r||s form WebCrypto verifies. */
function derToP1363(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  let offset = 0
  const next = () => der[offset++]
  if (next() !== 0x30) return null
  let length = next()
  if (length === 0x81) length = next()
  else if (length === undefined || length > 0x7f) return null
  if (length !== der.length - offset) return null

  const out = new Uint8Array(new ArrayBuffer(64))
  for (const position of [0, 32]) {
    if (next() !== 0x02) return null
    const size = next()
    if (size === undefined || size === 0 || size > 33 || offset + size > der.length) return null
    let value = der.slice(offset, offset + size)
    offset += size
    while (value.length > 1 && value[0] === 0) value = value.slice(1)
    if (value.length > 32) return null
    out.set(value, position + 32 - value.length)
  }
  return offset === der.length ? out : null
}

async function verifySignature(
  stored: StoredPasskey,
  data: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const spki = decode(stored.publicKey, 'stored public key')
  if (stored.algorithm === COSE_ES256) {
    const raw = derToP1363(signature)
    if (!raw) return false
    const key = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, data)
  }
  if (stored.algorithm === COSE_RS256) {
    const key = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, data)
  }
  fail('unsupported credential algorithm')
}

export async function verifyAuthentication(
  credential: AuthenticationCredential,
  expected: ExpectedCeremony & { webauthnUserId: string },
  stored: StoredPasskey,
): Promise<{ signCount: number; backedUp: boolean }> {
  checkCredentialId(credential.id, credential.rawId)
  if (credential.id !== stored.credentialId) fail('credential id mismatch')

  const clientDataJSON = decode(credential.response.clientDataJSON, 'client data')
  checkClientData(parseClientData(clientDataJSON), 'webauthn.get', expected)

  const authData = decode(credential.response.authenticatorData, 'authenticator data')
  const parsed = await parseAuthenticatorData(authData, expected.rpId)
  if (!parsed.userPresent) fail('user presence flag is not set')
  if (!parsed.userVerified) fail('user verification flag is not set')

  const handle = credential.response.userHandle
  if (handle != null && handle !== userHandle(expected.webauthnUserId)) {
    fail('user handle mismatch')
  }

  const signed = concatBytes(authData, await sha256(clientDataJSON))
  const signature = decode(credential.response.signature, 'signature')
  if (!(await verifySignature(stored, signed, signature))) fail('signature is invalid')

  // Authenticators without a counter always report 0 (synced passkeys do).
  // Otherwise the counter must grow, or the credential may have been cloned.
  if ((parsed.signCount !== 0 || stored.signCount !== 0) && parsed.signCount <= stored.signCount) {
    fail('signature counter did not increase')
  }
  return { signCount: parsed.signCount, backedUp: parsed.backedUp }
}
