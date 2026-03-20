import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    BaseSerializer,
    get_serializer,
    list_serializers,
} from '../src/core/serializers/base.js'
import { EnvSerializer } from '../src/core/serializers/env.js'
import { InsecureJsonSerializer } from '../src/core/serializers/backup.js'
import { JsonCryptSerializer } from '../src/core/serializers/json-crypt.js'
import { CommandSerializer } from '../src/core/serializers/command.js'
import { Secret } from '../src/core/models/secret.js'
import { User } from '../src/core/models/user.js'
import { generate_symmetric_key } from '../src/core/crypto/utils.js'
import { generate_key_pair, encode_key } from '../src/core/crypto/nacl.js'

let tmp_dir

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-test-'))
    generate_symmetric_key(tmp_dir)
    process.env.JSEEQRET = tmp_dir
})

afterEach(() => {
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

// -- helpers --

function make_secrets() {
    return [
        new Secret({ app: 'myapp', env: 'dev', key: 'DB_HOST', plaintext_value: 'localhost', vault_dir: tmp_dir }),
        new Secret({ app: 'myapp', env: 'dev', key: 'DB_PASS', plaintext_value: 's3cret', vault_dir: tmp_dir }),
        new Secret({ app: 'myapp', env: 'dev', key: 'PORT', plaintext_value: '5432', type: 'int', vault_dir: tmp_dir }),
    ]
}

function make_user_pair() {
    const sender_kp = generate_key_pair()
    const receiver_kp = generate_key_pair()
    const sender = new User('alice', 'alice@test.com', encode_key(sender_kp.publicKey))
    const receiver = new User('bob', 'bob@test.com', encode_key(receiver_kp.publicKey))
    return { sender, receiver, sender_kp, receiver_kp }
}

// -- BaseSerializer & registry --

describe('BaseSerializer', () => {
    it('dumps throws Not implemented', () => {
        const s = new BaseSerializer()
        expect(() => s.dumps([])).toThrow('Not implemented')
    })

    it('load throws Not implemented', () => {
        const s = new BaseSerializer()
        expect(() => s.load('')).toThrow('Not implemented')
    })

    it('stores sender/receiver options', () => {
        const s = new BaseSerializer({ sender: 'a', receiver: 'b' })
        expect(s.sender).toBe('a')
        expect(s.receiver).toBe('b')
    })
})

describe('serializer registry', () => {
    it('get_serializer returns registered class by tag', () => {
        const cls = get_serializer('env')
        expect(cls).toBe(EnvSerializer)
    })

    it('get_serializer throws for unknown tag', () => {
        expect(() => get_serializer('nonexistent')).toThrow('Unknown serializer')
    })

    it('list_serializers returns all registered serializers', () => {
        const all = list_serializers()
        const tags = all.map(c => c.tag).sort()
        expect(tags).toContain('env')
        expect(tags).toContain('backup')
        expect(tags).toContain('json-crypt')
        expect(tags).toContain('command')
    })
})

// -- EnvSerializer --

describe('EnvSerializer', () => {
    it('dumps secrets as KEY="VALUE" lines', () => {
        const secrets = make_secrets()
        const serializer = new EnvSerializer()
        const output = serializer.dumps(secrets)

        expect(output).toContain('DB_HOST="localhost"')
        expect(output).toContain('DB_PASS="s3cret"')
        expect(output).toContain('PORT="5432"')
    })

    it('load throws not supported', () => {
        const serializer = new EnvSerializer()
        expect(() => serializer.load('KEY=val')).toThrow('does not support loading')
    })

    it('has correct static properties', () => {
        expect(EnvSerializer.tag).toBe('env')
        expect(EnvSerializer.version).toBe(1)
    })
})

// -- InsecureJsonSerializer (backup) --

describe('InsecureJsonSerializer', () => {
    it('dumps secrets as plaintext JSON', () => {
        const secrets = make_secrets()
        const serializer = new InsecureJsonSerializer()
        const output = serializer.dumps(secrets)
        const parsed = JSON.parse(output)

        expect(parsed.version).toBe(1)
        expect(parsed.from).toBe('self')
        expect(parsed.to).toBe('self')
        expect(parsed.secrets).toHaveLength(3)
        expect(parsed.signature).toHaveLength(5)

        const db_host = parsed.secrets.find(s => s.key === 'DB_HOST')
        expect(db_host.value).toBe('localhost')
        expect(db_host.app).toBe('myapp')
    })

    it('round-trips through dumps/load', () => {
        const secrets = make_secrets()
        const serializer = new InsecureJsonSerializer()
        const json_str = serializer.dumps(secrets)
        const loaded = serializer.load(json_str)

        expect(loaded).toHaveLength(3)
        const db_host = loaded.find(s => s.key === 'DB_HOST')
        expect(db_host.get_value()).toBe('localhost')

        const port = loaded.find(s => s.key === 'PORT')
        expect(port.type).toBe('int')
        expect(port.get_value()).toBe(5432)
    })

    it('includes sender/receiver usernames when provided', () => {
        const { sender, receiver } = make_user_pair()
        const serializer = new InsecureJsonSerializer({ sender, receiver })
        const output = JSON.parse(serializer.dumps(make_secrets()))
        expect(output.from).toBe('alice')
        expect(output.to).toBe('bob')
    })

    it('has correct static properties', () => {
        expect(InsecureJsonSerializer.tag).toBe('backup')
    })
})

// -- JsonCryptSerializer --

describe('JsonCryptSerializer', () => {
    it('round-trips through dumps/load', () => {
        const { sender, receiver, sender_kp, receiver_kp } = make_user_pair()

        const dump_serializer = new JsonCryptSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })
        const secrets = make_secrets()
        const json_str = dump_serializer.dumps(secrets)
        const parsed = JSON.parse(json_str)

        expect(parsed.version).toBe(1)
        expect(parsed.from).toBe('alice')
        expect(parsed.to).toBe('bob')
        expect(parsed.secrets).toHaveLength(3)
        expect(parsed.signature).toHaveLength(5)

        // Values should be encrypted (not plaintext)
        const db_host = parsed.secrets.find(s => s.key === 'DB_HOST')
        expect(db_host.value).not.toBe('localhost')

        // Load with receiver's private key
        const load_serializer = new JsonCryptSerializer({
            sender,
            receiver,
            receiver_private_key: receiver_kp.secretKey,
        })
        const loaded = load_serializer.load(json_str)

        expect(loaded).toHaveLength(3)
        const loaded_host = loaded.find(s => s.key === 'DB_HOST')
        expect(loaded_host.get_value()).toBe('localhost')

        const loaded_port = loaded.find(s => s.key === 'PORT')
        expect(loaded_port.type).toBe('int')
        expect(loaded_port.get_value()).toBe(5432)
    })

    it('fails to load with wrong private key', () => {
        const { sender, receiver, sender_kp } = make_user_pair()
        const wrong_kp = generate_key_pair()

        const dump_serializer = new JsonCryptSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })
        const json_str = dump_serializer.dumps(make_secrets())

        const load_serializer = new JsonCryptSerializer({
            sender,
            receiver,
            receiver_private_key: wrong_kp.secretKey,
        })
        expect(() => load_serializer.load(json_str)).toThrow()
    })

    it('has correct static properties', () => {
        expect(JsonCryptSerializer.tag).toBe('json-crypt')
    })
})

// -- CommandSerializer --

describe('CommandSerializer', () => {
    it('dumps produces jseeqret load commands', () => {
        const { sender, receiver, sender_kp } = make_user_pair()
        const serializer = new CommandSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })
        const output = serializer.dumps(make_secrets(), 'linux')

        const lines = output.split('\n').filter(l => l.trim())
        expect(lines).toHaveLength(3)

        for (const line of lines) {
            expect(line).toMatch(/^jseeqret load -ualice -scommand -v/)
        }
    })

    it('round-trips through dumps/load', () => {
        const { sender, receiver, sender_kp, receiver_kp } = make_user_pair()

        const dump_serializer = new CommandSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })
        const output = dump_serializer.dumps(make_secrets(), 'linux')

        const load_serializer = new CommandSerializer({
            sender,
            receiver,
            receiver_private_key: receiver_kp.secretKey,
        })
        const loaded = load_serializer.load(output)

        expect(loaded).toHaveLength(3)
        const db_host = loaded.find(s => s.key === 'DB_HOST')
        expect(db_host.get_value()).toBe('localhost')

        const port = loaded.find(s => s.key === 'PORT')
        expect(port.type).toBe('int')
        expect(port.get_value()).toBe(5432)
    })

    it('uses CRLF on win32', () => {
        const { sender, receiver, sender_kp } = make_user_pair()
        const serializer = new CommandSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })
        const output = serializer.dumps(make_secrets(), 'win32')
        expect(output).toContain('\r\n')
    })

    it('uses LF on linux', () => {
        const { sender, receiver, sender_kp } = make_user_pair()
        const serializer = new CommandSerializer({
            sender,
            receiver,
            sender_private_key: sender_kp.secretKey,
        })
        const output = serializer.dumps(make_secrets(), 'linux')
        expect(output).not.toContain('\r\n')
    })

    it('load rejects malformed command lines', () => {
        const { sender, receiver, receiver_kp } = make_user_pair()
        const serializer = new CommandSerializer({
            sender,
            receiver,
            receiver_private_key: receiver_kp.secretKey,
        })
        expect(() => serializer.load('jseeqret load -ualice -scommand -vtoo:few:parts')).toThrow('Invalid command format')
    })

    it('has correct static properties', () => {
        expect(CommandSerializer.tag).toBe('command')
    })
})
