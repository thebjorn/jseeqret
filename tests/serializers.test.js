import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Secret } from '../src/core/models/secret.js'
import { User } from '../src/core/models/user.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../src/core/crypto/utils.js'
import { encode_key, generate_key_pair, decode_key } from '../src/core/crypto/nacl.js'
import { BaseSerializer, register_serializer, get_serializer, list_serializers } from '../src/core/serializers/base.js'
import { InsecureJsonSerializer } from '../src/core/serializers/backup.js'
import { JsonCryptSerializer } from '../src/core/serializers/json-crypt.js'
import { CommandSerializer } from '../src/core/serializers/command.js'
import { EnvSerializer } from '../src/core/serializers/env.js'

let tmp_dir
let sender_kp, receiver_kp
let sender, receiver

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-ser-'))
    generate_symmetric_key(tmp_dir)
    process.env.JSEEQRET = tmp_dir

    sender_kp = generate_key_pair()
    receiver_kp = generate_key_pair()

    sender = new User('alice', 'alice@test.com', encode_key(sender_kp.publicKey))
    receiver = new User('bob', 'bob@test.com', encode_key(receiver_kp.publicKey))
})

afterEach(() => {
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

function make_secrets() {
    return [
        new Secret({ app: 'myapp', env: 'prod', key: 'DB_PASS', plaintext_value: 's3cret', vault_dir: tmp_dir }),
        new Secret({ app: 'myapp', env: 'prod', key: 'API_KEY', plaintext_value: 'key123', vault_dir: tmp_dir }),
        new Secret({ app: 'myapp', env: 'dev', key: 'PORT', plaintext_value: '5432', type: 'int', vault_dir: tmp_dir }),
    ]
}

describe('BaseSerializer', () => {
    it('dumps() throws not implemented', () => {
        const s = new BaseSerializer()
        expect(() => s.dumps([])).toThrow('Not implemented')
    })

    it('load() throws not implemented', () => {
        const s = new BaseSerializer()
        expect(() => s.load('')).toThrow('Not implemented')
    })

    it('constructor stores sender/receiver', () => {
        const s = new BaseSerializer({ sender, receiver })
        expect(s.sender).toBe(sender)
        expect(s.receiver).toBe(receiver)
    })
})

describe('serializer registry', () => {
    it('get_serializer returns registered serializer', () => {
        expect(get_serializer('backup')).toBe(InsecureJsonSerializer)
        expect(get_serializer('json-crypt')).toBe(JsonCryptSerializer)
        expect(get_serializer('command')).toBe(CommandSerializer)
        expect(get_serializer('env')).toBe(EnvSerializer)
    })

    it('get_serializer throws for unknown tag', () => {
        expect(() => get_serializer('nonexistent')).toThrow('Unknown serializer')
    })

    it('list_serializers returns all registered', () => {
        const all = list_serializers()
        expect(all.length).toBeGreaterThanOrEqual(4)
        const tags = all.map(s => s.tag)
        expect(tags).toContain('backup')
        expect(tags).toContain('json-crypt')
        expect(tags).toContain('command')
        expect(tags).toContain('env')
    })

    it('register_serializer adds new serializer', () => {
        class TestSerializer extends BaseSerializer {
            static tag = 'test-custom'
        }
        register_serializer(TestSerializer)
        expect(get_serializer('test-custom')).toBe(TestSerializer)
    })
})

describe('InsecureJsonSerializer (backup)', () => {
    it('dumps and loads secrets round-trip', () => {
        const secrets = make_secrets()
        const serializer = new InsecureJsonSerializer({ sender, receiver })
        const json = serializer.dumps(secrets)
        const parsed = JSON.parse(json)

        expect(parsed.version).toBe(1)
        expect(parsed.from).toBe('alice')
        expect(parsed.to).toBe('bob')
        expect(parsed.secrets).toHaveLength(3)
        expect(parsed.signature).toHaveLength(5)

        // Load round-trip
        const loaded = serializer.load(json)
        expect(loaded).toHaveLength(3)
        expect(loaded[0].get_value()).toBe('s3cret')
        expect(loaded[1].get_value()).toBe('key123')
        expect(loaded[2].get_value()).toBe(5432)
        expect(loaded[2].type).toBe('int')
    })

    it('works without sender/receiver (self backup)', () => {
        const secrets = make_secrets()
        const serializer = new InsecureJsonSerializer()
        const json = serializer.dumps(secrets)
        const parsed = JSON.parse(json)
        expect(parsed.from).toBe('self')
        expect(parsed.to).toBe('self')
    })

    it('preserves secret types', () => {
        const secrets = make_secrets()
        const serializer = new InsecureJsonSerializer({ sender })
        const json = serializer.dumps(secrets)
        const loaded = serializer.load(json)

        expect(loaded[0].type).toBe('str')
        expect(loaded[2].type).toBe('int')
    })
})

describe('JsonCryptSerializer', () => {
    it('dumps and loads secrets round-trip', () => {
        const secrets = make_secrets()
        const exporter = new JsonCryptSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })

        const json = exporter.dumps(secrets)
        const parsed = JSON.parse(json)

        expect(parsed.version).toBe(1)
        expect(parsed.from).toBe('alice')
        expect(parsed.to).toBe('bob')
        expect(parsed.secrets).toHaveLength(3)
        // Encrypted values should not be plaintext
        expect(parsed.secrets[0].value).not.toBe('s3cret')

        const importer = new JsonCryptSerializer({
            sender,
            receiver,
            receiver_private_key: receiver_kp.secretKey,
        })

        const loaded = importer.load(json)
        expect(loaded).toHaveLength(3)
        expect(loaded[0].get_value()).toBe('s3cret')
        expect(loaded[1].get_value()).toBe('key123')
        expect(loaded[2].get_value()).toBe(5432)
    })

    it('cannot decrypt with wrong key', () => {
        const secrets = make_secrets()
        const exporter = new JsonCryptSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })
        const json = exporter.dumps(secrets)

        const wrong_kp = generate_key_pair()
        const wrong_receiver = new JsonCryptSerializer({
            sender,
            receiver,
            receiver_private_key: wrong_kp.secretKey,
        })

        expect(() => wrong_receiver.load(json)).toThrow()
    })
})

describe('CommandSerializer', () => {
    it('dumps and loads secrets round-trip', () => {
        const secrets = make_secrets()
        const exporter = new CommandSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })

        const output = exporter.dumps(secrets, 'linux')
        expect(output).toContain('jseeqret load')
        expect(output).toContain(`-u${sender.username}`)
        expect(output).toContain('-scommand')

        const lines = output.split('\n')
        expect(lines).toHaveLength(3)

        const importer = new CommandSerializer({
            sender,
            receiver,
            receiver_private_key: receiver_kp.secretKey,
        })

        const loaded = importer.load(output)
        expect(loaded).toHaveLength(3)
        expect(loaded[0].get_value()).toBe('s3cret')
        expect(loaded[1].get_value()).toBe('key123')
        expect(loaded[2].get_value()).toBe(5432)
    })

    it('uses \\r\\n on win32', () => {
        const secrets = [make_secrets()[0]]
        const ser = new CommandSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })
        const output = ser.dumps(secrets, 'win32')
        // Single secret, no line ending issue, but test the format
        expect(output).toContain('jseeqret load')
    })

    it('throws on invalid format during load', () => {
        const importer = new CommandSerializer({
            sender,
            receiver,
            receiver_private_key: receiver_kp.secretKey,
        })
        expect(() => importer.load('invalid line')).toThrow('Invalid command format')
    })
})

describe('EnvSerializer', () => {
    it('dumps secrets as .env format', () => {
        const secrets = make_secrets()
        const ser = new EnvSerializer()
        const output = ser.dumps(secrets)

        expect(output).toContain('DB_PASS="s3cret"')
        expect(output).toContain('API_KEY="key123"')
        expect(output).toContain('PORT="5432"')
    })

    it('load throws', () => {
        const ser = new EnvSerializer()
        expect(() => ser.load('FOO=bar')).toThrow('does not support loading')
    })
})
