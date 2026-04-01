import { Command } from 'commander'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const project_root = resolve(__dirname, '..', '..', '..')

export const gui_command = new Command('gui')
    .description('Launch the Electron GUI')
    .option('--dev', 'Start in development mode with hot reload')
    .action(async (opts) => {
        const cmd = opts.dev ? 'npm' : 'electron'
        const args = opts.dev ? ['run', 'dev'] : ['.']

        const child = spawn(cmd, args, {
            cwd: project_root,
            stdio: 'inherit',
            shell: true,
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
