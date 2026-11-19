import type {
  AuthenticationCredential,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  RegistrationCredential,
} from '@kanso/shared'
import { ApiError } from '../api/errors.ts'

export function toBase64Url(value: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function descriptors(items: { id: string; transports?: string[] }[]) {
  return items.map((item) => ({
    type: 'public-key' as const,
    id: fromBase64Url(item.id),
    ...(item.transports ? { transports: item.transports as AuthenticatorTransport[] } : {}),
  }))
}

export function creationOptionsFromJSON(
  options: PasskeyCreationOptions,
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    user: { ...options.user, id: fromBase64Url(options.user.id) },
    excludeCredentials: descriptors(options.excludeCredentials),
  }
}

export function requestOptionsFromJSON(
  options: PasskeyRequestOptions,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    allowCredentials: descriptors(options.allowCredentials),
  }
}

type CredentialLike = Pick<PublicKeyCredential, 'id' | 'rawId' | 'response'> & {
  authenticatorAttachment?: string | null
}

export function registrationToJSON(credential: CredentialLike): RegistrationCredential {
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports:
        typeof response.getTransports === 'function' ? response.getTransports() : undefined,
    },
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
  }
}

export function authenticationToJSON(credential: CredentialLike): AuthenticationCredential {
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
  }
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
}

/** Thrown when the browser API returns nothing (the user dismissed the dialog). */
class PasskeyCancelled extends Error {
  constructor() {
    super('Passkey ceremony returned no credential')
    this.name = 'NotAllowedError'
  }
}

export async function createPasskey(
  options: PasskeyCreationOptions,
): Promise<RegistrationCredential> {
  const credential = await navigator.credentials.create({
    publicKey: creationOptionsFromJSON(options),
  })
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyCancelled()
  return registrationToJSON(credential)
}

export async function getPasskey(
  options: PasskeyRequestOptions,
): Promise<AuthenticationCredential> {
  const credential = await navigator.credentials.get({
    publicKey: requestOptionsFromJSON(options),
  })
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyCancelled()
  return authenticationToJSON(credential)
}

/** Japanese message for a failure anywhere in a passkey ceremony. */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return '試行が続いたため、一時的に受け付けを止めています。10 分ほど待ってからもう一度お試しください。'
    }
    if (error.status === 404)
      return 'このリンクは無効か、有効期限が切れています。新しいリンクを発行してください。'
    if (/challenge/i.test(error.message)) {
      return '確認に時間がかかりすぎました。もう一度お試しください。'
    }
    if (/not registered/i.test(error.message)) {
      return 'このパスキーは登録されていません。別のパスキーを選んでください。'
    }
    if (/already registered/i.test(error.message)) {
      return 'このパスキーはすでに登録されています。'
    }
    if (/last passkey/i.test(error.message)) {
      return '最後のパスキーは削除できません。先に別のパスキーを追加してください。'
    }
    if (/up to/i.test(error.message)) return '登録できるパスキーは 10 個までです。'
    if (error.status === 401) return 'パスキーを確認できませんでした。もう一度お試しください。'
    return error.message
  }
  if (error instanceof Error) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'AbortError':
        return 'パスキーの操作がキャンセルされたか、時間切れになりました。'
      case 'InvalidStateError':
        return 'この端末のパスキーはすでに登録されています。'
      case 'SecurityError':
        return 'このアドレスではパスキーを使えません。https のアドレスか localhost で開いてください。'
      case 'NotSupportedError':
        return 'このブラウザか端末はパスキーに対応していません。'
    }
  }
  return 'パスキーの処理に失敗しました。もう一度お試しください。'
}

/** A name for a new passkey, so the list tells devices apart until renamed. */
export function defaultPasskeyName(userAgent: string = navigator.userAgent): string {
  const device = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'Mac'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux|CrOS/.test(userAgent)
              ? 'Linux'
              : 'この端末'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null
  return browser ? `${device} の ${browser}` : device
}
