import { Command } from 'commander'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const project_root = resolve(__dirname, '..', '..', '..')

/**
 * Launch the Electron desktop UI against the current vault. In the
 * published binary it spawns the packaged `electron` process; `--dev`
 * runs `npm run dev` with hot reload for working on the UI itself.
 *
 * @example
 * jseeqret gui
 */
export const gui_command = new Command('gui')
    .description('Launch the Electron GUI')
    .option('--dev', 'Start in development mode with hot reload')
    .action(async (opts) => {
        const cmd = opts.dev ? 'npm' : 'electron'
        const args = opts.dev ? ['run', 'dev'] : ['.']

        // `cmd` and `args` are static literals — no user input reaches the
        // spawn, so there is no injection surface. `shell` is enabled only
        // on Windows, where `npm`/`electron` are `.cmd` shims that Node
        // refuses to spawn without a shell (EINVAL since the CVE-2024-27980
        // hardening). Hence the deliberate, scoped `shell` here.
        // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true
        const child = spawn(cmd, args, {
            cwd: project_root,
            stdio: 'inherit',
            shell: process.platform === 'win32',
            detached: !opts.dev,
        })

        if (opts.dev) {
            child.on('close', (code) => {
                process.exit(code ?? 0)
            })
        } else {
            child.unref()
            process.exit(0)
        }
    })
