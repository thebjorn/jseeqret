import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { create_test_vault, cleanup_vault, run_command } from './cli-helpers.js'
import { Secret } from '../src/core/models/secret.js'
import { Remote } from '../src/core/models/remote.js'
import {
    shell_quote,
    render_cmd,
    push_secret,
    verify_secret,
} from '../src/core/remote-ssh.js'

const SERVER = 'deploy@server.example.com'
const SET_CMD = 'myvault set-secret --key {key} --value {value}'
const SET_CMD_STDIN = 'myvault set-secret --key {key} --stdin'
const GET_CMD = 'myvault get-secret --key {key} --stdout'

let tmp_dir

beforeEach(async () => {
    ({ tmp_dir } = await create_test_vault())
})

afterEach(() => {
    cleanup_vault(tmp_dir)
})

/**
 * Register the test remote. get_cmd: undefined = default, null = omit.
 */
function add_server({ set_cmd = SET_CMD, get_cmd = GET_CMD } = {}) {
    const args = ['remote', 'add', 'myserver', SERVER, '--set', set_cmd]
    if (get_cmd != null) {
        args.push('--get', get_cmd)
    }
    return run_command(args, { vault_dir: tmp_dir })
}

function add_secret(name, value, app = 'myapp', env = 'prod') {
    return run_command(
        ['add', 'key', name, value, '--app', app, '--env', env],
        { vault_dir: tmp_dir }
    )
}

function make_remote({ set_cmd = SET_CMD, get_cmd = GET_CMD } = {}) {
    return new Remote({
        alias: 'myserver',
        username: 'deploy',
        hostname: 'server.example.com',
        set_cmd,
        get_cmd,
    })
}

function make_secret(key = 'FOO', value = 'secret123') {
    return new Secret({
        app: 'myapp', env: 'prod', key,
        plaintext_value: value, vault_dir: tmp_dir,
    })
}

/**
 * A recording stand-in for ssh_run.
 */
function recording_run(result = { returncode: 0, stdout: '', stderr: '' }) {
    const calls = []
    const run = (remote, cmd, input) => {
        calls.push({ userhost: remote.userhost, cmd, input })
        return result
    }
    return { calls, run }
}

describe('remote add/list/rm', () => {
    it('roundtrips add, list, rm', () => {
        let res = add_server()
        expect(res.exit_code).toBe(0)
        expect(res.stdout).toContain('Added remote myserver')

        res = run_command(['remote', 'list'], { vault_dir: tmp_dir })
        expect(res.exit_code).toBe(0)
        expect(res.stdout).toContain('myserver')
        expect(res.stdout).toContain(SERVER)
        expect(res.stdout).toContain('set-secret')
        expect(res.stdout).toContain('get-secret')

        res = run_command(['remote', 'rm', 'myserver'], { vault_dir: tmp_dir })
        expect(res.exit_code).toBe(0)

        res = run_command(['remote', 'list'], { vault_dir: tmp_dir })
        expect(res.exit_code).toBe(0)
        expect(res.stdout).toContain('No remotes registered')
    })

    it('updates an existing alias in place', () => {
        add_server()
        const res = run_command(
            ['remote', 'add', 'myserver', 'other@example.com',
             '--set', 'newtool set {key} {value}'],
            { vault_dir: tmp_dir }
        )
        expect(res.exit_code).toBe(0)

        const list = run_command(['remote', 'list'], { vault_dir: tmp_dir })
        expect(list.stdout).toContain('other@example.com')
        expect(list.stdout).toContain('newtool')
        expect(list.stdout).not.toContain(SERVER)
    })

    it('rejects a userhost without an @', () => {
        const res = run_command(
            ['remote', 'add', 'myserver', 'no-at-sign', '--set', SET_CMD],
            { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('USER@HOST')
    })

    it('requires {key} in the --set template', () => {
        const res = run_command(
            ['remote', 'add', 'myserver', SERVER, '--set', 'tool set -k KEY'],
            { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('{key}')
    })

    it('requires {key} in the --get template', () => {
        const res = run_command(
            ['remote', 'add', 'myserver', SERVER,
             '--set', SET_CMD, '--get', 'tool get FOO'],
            { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('{key}')
    })

    it('reports the value delivery mode', () => {
        let res = add_server({ set_cmd: SET_CMD_STDIN })
        expect(res.stdout).toContain('piped on stdin')

        res = add_server({ set_cmd: SET_CMD })
        expect(res.stdout).toContain('on the remote command line')
    })

    it('rm of an unknown alias fails', () => {
        const res = run_command(
            ['remote', 'rm', 'nosuch'], { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('No remote named nosuch')
    })
})

describe('push - CLI level', () => {
    it('dry-run masks the value and shows the ssh command line', () => {
        add_secret('FOO', 'secret123')
        add_server({ set_cmd: SET_CMD })

        const res = run_command(
            ['push', 'myserver', 'myapp:prod:FOO', '--dry-run'],
            { vault_dir: tmp_dir }
        )
        expect(res.exit_code).toBe(0)
        expect(res.stdout).toContain('would push FOO')
        expect(res.stdout).toContain(`ssh ${SERVER}`)
        expect(res.stdout).toContain('*****')
        expect(res.stdout).not.toContain('secret123')
    })

    it('dry-run in stdin mode prints the exact command', () => {
        add_secret('FOO', 'secret123')
        add_server({ set_cmd: SET_CMD_STDIN })

        const res = run_command(
            ['push', 'myserver', 'myapp:prod:FOO', '--dry-run'],
            { vault_dir: tmp_dir }
        )
        expect(res.exit_code).toBe(0)
        expect(res.stdout).toContain('myvault set-secret --key FOO --stdin')
        expect(res.stdout).toContain('(value on stdin)')
        expect(res.stdout).not.toContain('secret123')
    })

    it('fails on an unknown alias', () => {
        add_secret('FOO', 'secret123')
        const res = run_command(
            ['push', 'nosuch', 'myapp:prod:FOO'], { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('No remote named nosuch')
    })

    it('fails when no secrets match', () => {
        add_server()
        const res = run_command(
            ['push', 'myserver', 'nonexistent:app:KEY', '--dry-run'],
            { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('No secrets found')
    })

    it('fails on duplicate keys across app/env', () => {
        add_secret('API_KEY', 'v1', 'app1', 'dev')
        add_secret('API_KEY', 'v2', 'app2', 'dev')
        add_server()

        const res = run_command(
            ['push', 'myserver', '::API_KEY', '--dry-run'],
            { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('Duplicate key')
    })
})

describe('verify - CLI level', () => {
    it('fails when the remote has no get command', () => {
        add_secret('FOO', 'secret123')
        add_server({ get_cmd: null })

        const res = run_command(
            ['verify', 'myserver', 'myapp:prod:FOO'], { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('no get command')
    })

    it('fails on an unknown alias', () => {
        const res = run_command(
            ['verify', 'nosuch', 'myapp:prod:FOO'], { vault_dir: tmp_dir }
        )
        expect(res.exit_code).not.toBe(0)
        expect(res.stderr).toContain('No remote named nosuch')
    })
})

describe('shell_quote', () => {
    it('leaves safe strings alone', () => {
        expect(shell_quote('FOO')).toBe('FOO')
        expect(shell_quote('a/b.c_d-e')).toBe('a/b.c_d-e')
    })

    it('quotes the empty string', () => {
        expect(shell_quote('')).toBe("''")
    })

    it('quotes spaces and shell metacharacters', () => {
        expect(shell_quote('a b')).toBe("'a b'")
        expect(shell_quote('$HOME')).toBe("'$HOME'")
    })

    it('escapes embedded single quotes', () => {
        expect(shell_quote("it's")).toBe(`'it'"'"'s'`)
    })
})

describe('render_cmd', () => {
    it('substitutes key and value shell-quoted', () => {
        expect(render_cmd(SET_CMD, 'FOO', 'a b')).toBe(
            "myvault set-secret --key FOO --value 'a b'"
        )
    })

    it('replaces every occurrence of a placeholder', () => {
        expect(render_cmd('echo {key} {key}', 'FOO')).toBe('echo FOO FOO')
    })

    it('leaves {value} alone when no value is given', () => {
        expect(render_cmd(SET_CMD, 'FOO')).toBe(
            'myvault set-secret --key FOO --value {value}'
        )
    })
})

describe('push_secret', () => {
    it('puts the value on the command line in cmdline mode', () => {
        const { calls, run } = recording_run()
        const res = push_secret(make_remote(), make_secret(), run)

        expect(res.ok).toBe(true)
        expect(calls).toHaveLength(1)
        expect(calls[0].userhost).toBe(SERVER)
        expect(calls[0].cmd).toBe(
            'myvault set-secret --key FOO --value secret123'
        )
        expect(calls[0].input).toBe(null)
    })

    it('pipes the value on stdin in stdin mode', () => {
        const { calls, run } = recording_run()
        const remote = make_remote({ set_cmd: SET_CMD_STDIN })
        const res = push_secret(remote, make_secret(), run)

        expect(res.ok).toBe(true)
        expect(calls[0].cmd).toBe('myvault set-secret --key FOO --stdin')
        expect(calls[0].input).toBe('secret123')
    })

    it('shell-quotes values with metacharacters', () => {
        const { calls, run } = recording_run()
        const secret = make_secret('FOO', "it's $HOME here")
        push_secret(make_remote(), secret, run)

        expect(calls[0].cmd).toBe(
            `myvault set-secret --key FOO --value 'it'"'"'s $HOME here'`
        )
    })

    it('reports failure with the stderr text', () => {
        const { run } = recording_run(
            { returncode: 255, stdout: '', stderr: 'connection refused' }
        )
        const res = push_secret(make_remote(), make_secret(), run)

        expect(res.ok).toBe(false)
        expect(res.error).toBe('connection refused')
    })
})

describe('verify_secret', () => {
    it('reports ok when the output matches', () => {
        const { calls, run } = recording_run(
            { returncode: 0, stdout: 'secret123\n', stderr: '' }
        )
        const status = verify_secret(make_remote(), make_secret(), run)

        expect(status).toBe('ok')
        expect(calls[0].cmd).toBe('myvault get-secret --key FOO --stdout')
        expect(calls[0].input).toBe(null)
    })

    it('reports mismatch when the output differs', () => {
        const { run } = recording_run(
            { returncode: 0, stdout: 'different\n', stderr: '' }
        )
        expect(verify_secret(make_remote(), make_secret(), run))
            .toBe('mismatch')
    })

    it('reports missing on a nonzero exit code', () => {
        const { run } = recording_run(
            { returncode: 1, stdout: '', stderr: 'no such key' }
        )
        expect(verify_secret(make_remote(), make_secret(), run))
            .toBe('missing')
    })
})
