import type { PasskeyCreationOptions } from '@kanso/shared'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/errors.ts'
import {
  authenticationToJSON,
  creationOptionsFromJSON,
  defaultPasskeyName,
  fromBase64Url,
  passkeyErrorMessage,
  registrationToJSON,
  requestOptionsFromJSON,
  toBase64Url,
} from './passkey.ts'

const bytes = (...values: number[]) => Uint8Array.from(values).buffer

describe('base64url', () => {
  it('round-trips binary data without padding', () => {
    const data = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255])
    const encoded = toBase64Url(data)
    expect(encoded).toBe('AAH6-_z9_v8')
    expect(new Uint8Array(fromBase64Url(encoded))).toEqual(data)
    expect(toBase64Url(new Uint8Array([1, 2, 3, 4]).subarray(1, 3))).toBe('AgM')
  })
})

describe('options from JSON', () => {
  it('turns base64url fields into buffers for navigator.credentials', () => {
    const options: PasskeyCreationOptions = {
      challenge: 'AQID',
      rp: { id: 'localhost', name: 'kansoCMS' },
      user: { id: 'BAU', name: 'admin@example.com', displayName: 'Admin' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 300000,
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      excludeCredentials: [{ type: 'public-key', id: 'Bgc', transports: ['internal'] }],
    }
    const converted = creationOptionsFromJSON(options)
    expect(new Uint8Array(converted.challenge as ArrayBuffer)).toEqual(Uint8Array.from([1, 2, 3]))
    expect(new Uint8Array(converted.user.id as ArrayBuffer)).toEqual(Uint8Array.from([4, 5]))
    expect(converted.user.name).toBe('admin@example.com')
    expect(converted.excludeCredentials?.[0]?.transports).toEqual(['internal'])

    const request = requestOptionsFromJSON({
      challenge: 'AQID',
      rpId: 'localhost',
      timeout: 300000,
      userVerification: 'required',
      allowCredentials: [],
    })
    expect(request.allowCredentials).toEqual([])
    expect(request.rpId).toBe('localhost')
  })
})

describe('credentials to JSON', () => {
  it('serializes a registration', () => {
    const json = registrationToJSON({
      id: 'AQI',
      rawId: bytes(1, 2),
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: bytes(3),
        attestationObject: bytes(4),
        getTransports: () => ['internal', 'hybrid'],
      } as unknown as AuthenticatorAttestationResponse,
    })
    expect(json).toEqual({
      id: 'AQI',
      rawId: 'AQI',
      type: 'public-key',
      response: {
        clientDataJSON: 'Aw',
        attestationObject: 'BA',
        transports: ['internal', 'hybrid'],
      },
      authenticatorAttachment: 'platform',
    })
  })

  it('serializes an assertion with and without a user handle', () => {
    const response = {
      clientDataJSON: bytes(1),
      authenticatorData: bytes(2),
      signature: bytes(3),
      userHandle: bytes(4),
    } as unknown as AuthenticatorAssertionResponse
    expect(authenticationToJSON({ id: 'AQ', rawId: bytes(1), response }).response).toEqual({
      clientDataJSON: 'AQ',
      authenticatorData: 'Ag',
      signature: 'Aw',
      userHandle: 'BA',
    })
    const anonymous = { ...response, userHandle: null } as AuthenticatorAssertionResponse
    expect(
      authenticationToJSON({ id: 'AQ', rawId: bytes(1), response: anonymous }).response.userHandle,
    ).toBeNull()
  })
})

describe('passkeyErrorMessage', () => {
  function named(name: string) {
    const error = new Error(name)
    error.name = name
    return error
  }

  it.each([
    [named('NotAllowedError'), 'キャンセル'],
    [named('InvalidStateError'), 'すでに登録'],
    [named('SecurityError'), 'localhost'],
    [new ApiError(401, 'unauthorized', 'This passkey is not registered'), '登録されていません'],
    [new ApiError(401, 'unauthorized', 'Passkey challenge is invalid or has expired'), '時間'],
    [new ApiError(409, 'conflict', 'The last passkey cannot be removed'), '最後のパスキー'],
    [new ApiError(409, 'conflict', 'A user can register up to 10 passkeys'), '10 個'],
    [new ApiError(404, 'not_found', 'Passkey link not found'), '有効期限'],
    [
      new ApiError(401, 'unauthorized', 'Passkey verification failed: origin mismatch'),
      '確認できません',
    ],
    [new Error('boom'), 'もう一度'],
  ])('explains %s in Japanese', (error, expected) => {
    expect(passkeyErrorMessage(error)).toContain(expected)
  })
})

describe('defaultPasskeyName', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      'Windows の Edge',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'iPhone の Safari',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      'Mac の Chrome',
    ],
    ['curl/8.0', 'この端末'],
  ])('names %s', (userAgent, expected) => {
    expect(defaultPasskeyName(userAgent)).toBe(expected)
  })
})
