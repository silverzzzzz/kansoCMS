import type { AuthenticationCredential, RegistrationCredential } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import { KansoError } from '../errors.ts'
import { decodeCbor } from './cbor.ts'
import { fromBase64Url, generateToken, toBase64Url, utf8 } from './encoding.ts'
import { encodeCbor, SoftAuthenticator } from './soft-authenticator.ts'
import {
  COSE_ES256,
  COSE_RS256,
  creationOptions,
  readChallenge,
  requestOptions,
  type StoredPasskey,
  userHandle,
  verifyAuthentication,
  verifyRegistration,
} from './webauthn.ts'

const rp = { id: 'localhost', name: 'kansoCMS', origin: 'http://localhost:5173' }
const webauthnUserId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

function registration(challenge = generateToken()) {
  return creationOptions({
    rp,
    user: { webauthnUserId, email: 'admin@example.com', name: 'Admin' },
    challenge,
    exclude: [],
  })
}

async function registered(authenticator: SoftAuthenticator) {
  const options = registration()
  const credential = await authenticator.register(options, rp.origin)
  const verified = await verifyRegistration(credential, {
    challenge: options.challenge,
    rpId: rp.id,
    origin: rp.origin,
  })
  const stored: StoredPasskey = {
    credentialId: verified.credentialId,
    publicKey: verified.publicKey,
    algorithm: verified.algorithm,
    signCount: verified.signCount,
  }
  return { verified, stored }
}

async function signIn(authenticator: SoftAuthenticator, overrides = {}) {
  const options = requestOptions({ rpId: rp.id, challenge: generateToken() })
  const credential = await authenticator.authenticate(options, rp.origin, overrides)
  return { options, credential }
}

function expected(challenge: string) {
  return { challenge, rpId: rp.id, origin: rp.origin, webauthnUserId }
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(KansoError)
  expect((error as KansoError).code).toBe('unauthorized')
  return (error as KansoError).message
}

describe('passkey options', () => {
  it('asks for a discoverable, user-verified ES256 or RS256 credential', () => {
    const options = creationOptions({
      rp,
      user: { webauthnUserId, email: 'admin@example.com', name: 'Admin' },
      challenge: 'challenge',
      exclude: [{ credentialId: 'abc', transports: ['internal'] }],
    })
    expect(options.user.id).toBe(userHandle(webauthnUserId))
    expect(options.pubKeyCredParams.map((item) => item.alg)).toEqual([COSE_ES256, COSE_RS256])
    expect(options.authenticatorSelection).toEqual({
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    })
    expect(options.excludeCredentials).toEqual([
      { type: 'public-key', id: 'abc', transports: ['internal'] },
    ])
    expect(requestOptions({ rpId: 'localhost', challenge: 'c' })).toMatchObject({
      allowCredentials: [],
      userVerification: 'required',
    })
  })
})

describe('passkey registration', () => {
  it('registers an ES256 passkey and stores its key as SPKI', async () => {
    const authenticator = await SoftAuthenticator.create()
    const { verified } = await registered(authenticator)
    expect(verified).toMatchObject({
      credentialId: authenticator.credentialId,
      algorithm: COSE_ES256,
      signCount: 0,
      transports: ['internal'],
    })
    // DER SubjectPublicKeyInfo for P-256 is 91 bytes.
    expect(fromBase64Url(verified.publicKey)?.length).toBe(91)
  })

  it('registers an RS256 passkey', async () => {
    const authenticator = await SoftAuthenticator.create({ algorithm: -257 })
    const { verified, stored } = await registered(authenticator)
    expect(verified.algorithm).toBe(COSE_RS256)

    const { options, credential } = await signIn(authenticator)
    await expect(
      verifyAuthentication(credential, expected(options.challenge), stored),
    ).resolves.toMatchObject({ signCount: 0 })
  })

  it.each([
    ['origin', { origin: 'https://evil.example' }, 'origin mismatch'],
    ['challenge', { challenge: 'other' }, 'challenge mismatch'],
    ['type', { type: 'webauthn.get' }, 'unexpected client data type'],
    ['RP ID', { rpId: 'evil.example' }, 'RP ID hash mismatch'],
    ['user verification', { userVerified: false }, 'user verification flag is not set'],
  ])('rejects a response with the wrong %s', async (_label, overrides, reason) => {
    const authenticator = await SoftAuthenticator.create()
    const options = registration()
    const credential = await authenticator.register(options, rp.origin, overrides)
    const message = await rejection(
      verifyRegistration(credential, {
        challenge: options.challenge,
        rpId: rp.id,
        origin: rp.origin,
      }),
    )
    expect(message).toContain(reason)
  })

  it('rejects a credential id that does not match the attested one', async () => {
    const authenticator = await SoftAuthenticator.create()
    const options = registration()
    const credential = await authenticator.register(options, rp.origin)
    const otherId = toBase64Url(utf8('another-credential'))
    const tampered: RegistrationCredential = { ...credential, id: otherId, rawId: otherId }
    const message = await rejection(
      verifyRegistration(tampered, {
        challenge: options.challenge,
        rpId: rp.id,
        origin: rp.origin,
      }),
    )
    expect(message).toContain('credential id mismatch')
  })

  it('rejects an unsupported key algorithm', async () => {
    const authenticator = await SoftAuthenticator.create()
    const options = registration()
    const credential = await authenticator.register(options, rp.origin)
    const attestation = decodeCbor(
      fromBase64Url(credential.response.attestationObject) ?? new Uint8Array(),
    ) as Map<string, Uint8Array>
    const authData = attestation.get('authData') ?? new Uint8Array()
    // EdDSA (-8) instead of ES256 (-7): the COSE alg value sits right after `3`.
    const coseStart = authData.length - 77
    const patched = authData.slice()
    expect(patched[coseStart + 3]).toBe(0x03)
    patched[coseStart + 4] = 0x27
    attestation.set('authData', patched)
    const tampered: RegistrationCredential = {
      ...credential,
      response: {
        ...credential.response,
        attestationObject: toBase64Url(encodeCbor(attestation)),
      },
    }
    const message = await rejection(
      verifyRegistration(tampered, {
        challenge: options.challenge,
        rpId: rp.id,
        origin: rp.origin,
      }),
    )
    expect(message).toContain('unsupported credential algorithm')
  })

  it('rejects garbage attestation objects', async () => {
    const authenticator = await SoftAuthenticator.create()
    const options = registration()
    const credential = await authenticator.register(options, rp.origin)
    const tampered: RegistrationCredential = {
      ...credential,
      response: { ...credential.response, attestationObject: toBase64Url(utf8('not cbor')) },
    }
    await rejection(
      verifyRegistration(tampered, {
        challenge: options.challenge,
        rpId: rp.id,
        origin: rp.origin,
      }),
    )
  })

  it('reads the challenge from client data', async () => {
    const authenticator = await SoftAuthenticator.create()
    const options = registration('the-challenge')
    const credential = await authenticator.register(options, rp.origin)
    expect(readChallenge(credential.response.clientDataJSON)).toBe('the-challenge')
    await rejection(Promise.resolve().then(() => readChallenge(toBase64Url(utf8('{')))))
  })
})

describe('passkey authentication', () => {
  it('signs in with a registered passkey', async () => {
    const authenticator = await SoftAuthenticator.create()
    const { stored } = await registered(authenticator)
    const { options, credential } = await signIn(authenticator)
    expect(credential.response.userHandle).toBe(userHandle(webauthnUserId))
    await expect(
      verifyAuthentication(credential, expected(options.challenge), stored),
    ).resolves.toEqual({ signCount: 0, backedUp: false })
  })

  it.each([
    ['origin', { origin: 'https://evil.example' }, 'origin mismatch'],
    ['challenge', { challenge: 'other' }, 'challenge mismatch'],
    ['type', { type: 'webauthn.create' }, 'unexpected client data type'],
    ['RP ID', { rpId: 'evil.example' }, 'RP ID hash mismatch'],
    ['user verification', { userVerified: false }, 'user verification flag is not set'],
  ])('rejects a response with the wrong %s', async (_label, overrides, reason) => {
    const authenticator = await SoftAuthenticator.create()
    const { stored } = await registered(authenticator)
    const { options, credential } = await signIn(authenticator, overrides)
    const message = await rejection(
      verifyAuthentication(credential, expected(options.challenge), stored),
    )
    expect(message).toContain(reason)
  })

  it('rejects a signature made by another key', async () => {
    const authenticator = await SoftAuthenticator.create()
    const { stored } = await registered(authenticator)
    const impostor = await SoftAuthenticator.create({ credentialId: authenticator.credentialId })
    impostor.userHandle = authenticator.userHandle
    const { options, credential } = await signIn(impostor)
    const message = await rejection(
      verifyAuthentication(credential, expected(options.challenge), stored),
    )
    expect(message).toContain('signature is invalid')
  })

  it('rejects tampered authenticator data', async () => {
    const authenticator = await SoftAuthenticator.create()
    const { stored } = await registered(authenticator)
    const { options, credential } = await signIn(authenticator)
    const authData = fromBase64Url(credential.response.authenticatorData) ?? new Uint8Array()
    authData[36] = 1 // bump the counter without re-signing
    const tampered: AuthenticationCredential = {
      ...credential,
      response: { ...credential.response, authenticatorData: toBase64Url(authData) },
    }
    const message = await rejection(
      verifyAuthentication(tampered, expected(options.challenge), stored),
    )
    expect(message).toContain('signature is invalid')
  })

  it('rejects a user handle that belongs to someone else', async () => {
    const authenticator = await SoftAuthenticator.create()
    const { stored } = await registered(authenticator)
    const { options, credential } = await signIn(authenticator)
    const message = await rejection(
      verifyAuthentication(
        credential,
        { ...expected(options.challenge), webauthnUserId: 'someone-else' },
        stored,
      ),
    )
    expect(message).toContain('user handle mismatch')
  })

  it('requires a growing counter once the authenticator reports one', async () => {
    const authenticator = await SoftAuthenticator.create({ signCount: 5 })
    const { stored } = await registered(authenticator)
    expect(stored.signCount).toBe(6)

    const first = await signIn(authenticator)
    await expect(
      verifyAuthentication(first.credential, expected(first.options.challenge), stored),
    ).resolves.toMatchObject({ signCount: 7 })

    const replayed = await signIn(authenticator, { signCount: 6 })
    const message = await rejection(
      verifyAuthentication(replayed.credential, expected(replayed.options.challenge), stored),
    )
    expect(message).toContain('signature counter did not increase')
  })

  it('rejects a credential that is not the stored one', async () => {
    const authenticator = await SoftAuthenticator.create()
    const { stored } = await registered(authenticator)
    const { options, credential } = await signIn(authenticator)
    const message = await rejection(
      verifyAuthentication(credential, expected(options.challenge), {
        ...stored,
        credentialId: 'other',
      }),
    )
    expect(message).toContain('credential id mismatch')
  })
})
