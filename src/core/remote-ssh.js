/**
 * Push/verify secrets on ssh remote targets (mirror of Python
 * seeqret's cli_remote_ssh module).
 *
 * The remote's command templates (`set_cmd`/`get_cmd`, stored in the
 * vault's `remotes` table) describe what to run on the host, so the
 * tools have no built-in knowledge of private server-side commands.
 *
 * @module core/remote-ssh
 */

import { spawnSync } from 'child_process'

const UNSAFE_RE = /[^\w@%+=:,./-]/

/**
 * Quote a string for a POSIX shell (mirror of Python's shlex.quote).
 * @param {string} s
 * @returns {string}
 */
export function shell_quote(s) {
    s = String(s)
    if (s === '') return "''"
    if (!UNSAFE_RE.test(s)) return s
    return "'" + s.replaceAll("'", `'"'"'`) + "'"
}

/**
 * Substitute {key}/{value} placeholders, shell-quoted for the remote
 * (POSIX) shell. Templates must not add their own quotes.
 * @param {string} template
 * @param {string} key
 * @param {string|null} [value]
 * @returns {string}
 */
export function render_cmd(template, key, value = null) {
    let cmd = template.replaceAll('{key}', shell_quote(key))
    if (value != null) {
        cmd = cmd.replaceAll('{value}', shell_quote(value))
    }
    return cmd
}

/**
 * Run a command on the remote host over ssh.
 * @param {import('./models/remote.js').Remote} remote
 * @param {string} remote_cmd
 * @param {string|null} [input] - piped to the remote command's stdin
 * @returns {{ returncode: number, stdout: string, stderr: string }}
 */
export function ssh_run(remote, remote_cmd, input = null) {
    const res = spawnSync('ssh', [remote.userhost, remote_cmd], {
        input: input ?? undefined,
        encoding: 'utf-8',
    })
    return {
        returncode: res.status ?? 1,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
    }
}

/**
 * Push one secret to a remote. In stdin mode (no {value} placeholder
 * in set_cmd) the value is piped on stdin instead of appearing on the
 * remote command line.
 * @param {import('./models/remote.js').Remote} remote
 * @param {import('./models/secret.js').Secret} secret
 * @param {function} [run=ssh_run] - injectable for tests
 * @returns {{ ok: boolean, error: string }}
 */
export function push_secret(remote, secret, run = ssh_run) {
    const value = String(secret.get_value())
    const cmd = render_cmd(remote.set_cmd, secret.key, value)
    const input = remote.value_via_stdin ? value : null
    const res = run(remote, cmd, input)

    if (res.returncode !== 0) {
        return { ok: false, error: (res.stderr || res.stdout).trim() }
    }
    return { ok: true, error: '' }
}

/**
 * Verify one secret against a remote by comparing the get command's
 * output to the vault value.
 * @param {import('./models/remote.js').Remote} remote
 * @param {import('./models/secret.js').Secret} secret
 * @param {function} [run=ssh_run] - injectable for tests
 * @returns {'ok'|'missing'|'mismatch'}
 */
export function verify_secret(remote, secret, run = ssh_run) {
    const cmd = render_cmd(remote.get_cmd, secret.key)
    const res = run(remote, cmd, null)

    if (res.returncode !== 0) return 'missing'
    if (res.stdout.trim() === String(secret.get_value())) return 'ok'
    return 'mismatch'
}
