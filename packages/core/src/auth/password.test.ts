import { describe, expect, it } from 'vitest'
import { generateToken, hashPassword, sha256Hex, verifyPassword } from './password.ts'

describe('password hashing', () => {
  it('verifies a password round trip', async () => {
    const stored = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
  })

  it('rejects a different password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('incorrect password', stored)).resolves.toBe(false)
  })

  it.each([
    '',
    'not-a-password-hash',
    'pbkdf2-sha256$99999$abc$def',
    'pbkdf2-sha256$100000$***$***',
    'pbkdf2-sha256$100000$YWJj$YWJj',
  ])('rejects a malformed stored value: %s', async (stored) => {
    await expect(verifyPassword('password', stored)).resolves.toBe(false)
  })

  it('uses the specified format and byte lengths', async () => {
    const stored = await hashPassword('correct horse battery staple')
    const [algorithm, iterations, salt, hash] = stored.split('$')

    expect(algorithm).toBe('pbkdf2-sha256')
    expect(iterations).toBe('100000')
    expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('token helpers', () => {
  it('generates a base64url token of the requested size', () => {
    expect(generateToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('returns a lowercase SHA-256 digest', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
