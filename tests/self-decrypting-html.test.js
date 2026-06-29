import { webcrypto } from 'crypto'
import {
    encrypt_payload,
    to_self_decrypting_html,
} from '../src/core/serializers/self-decrypting-html.js'

/**
 * Mirror the browser-side decrypt exactly (same Web Crypto calls the
 * embedded viewer uses). A passing decrypt here means the generated HTML
 * is decryptable by a real browser, since both run identical primitives.
 */
async function browser_decrypt(env, password) {
    const base_key = await webcrypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false,
        ['deriveKey'])
    const key = await webcrypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: Buffer.from(env.salt, 'base64'),
            iterations: env.iter,
            hash: 'SHA-256',
        },
        base_key, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
    const buf = await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(env.iv, 'base64') },
        key, Buffer.from(env.ct, 'base64'))
    return new TextDecoder().decode(buf)
}

describe('self-decrypting-html', () => {
    it('round-trips a payload with the correct password', async () => {
        const env = await encrypt_payload('hello secrets', 'hunter2')
        expect(env.cipher).toBe('AES-256-GCM')
        expect(env.kdf).toBe('PBKDF2-SHA256')
        const text = await browser_decrypt(env, 'hunter2')
        expect(text).toBe('hello secrets')
    })

    it('fails to decrypt with a wrong password', async () => {
        const env = await encrypt_payload('hello secrets', 'hunter2')
        await expect(browser_decrypt(env, 'wrong-password')).rejects.toThrow()
    })

    it('uses a fresh salt and iv on every call', async () => {
        const a = await encrypt_payload('x', 'pw')
        const b = await encrypt_payload('x', 'pw')
        expect(a.salt).not.toBe(b.salt)
        expect(a.iv).not.toBe(b.iv)
        expect(a.ct).not.toBe(b.ct)
    })

    it('embeds a parseable envelope and the decrypt script in the HTML', async () => {
        const html = await to_self_decrypting_html('{"secrets":[]}', 'pw')
        expect(html).toContain('id="vault"')
        expect(html).toContain('crypto.subtle')
        expect(html).toContain('AES-GCM')

        const m = html.match(/<script id="vault"[^>]*>([\s\S]*?)<\/script>/)
        expect(m).toBeTruthy()
        const env = JSON.parse(m[1])
        const text = await browser_decrypt(env, 'pw')
        expect(text).toBe('{"secrets":[]}')
    })

    it('requires a password', async () => {
        await expect(to_self_decrypting_html('data', '')).rejects.toThrow()
    })
})
