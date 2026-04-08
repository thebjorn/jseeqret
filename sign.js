import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Custom signing function for electron-builder.
 * Uses signtool with a Sectigo EV hardware token.
 *
 * The token must be plugged in and the SafeNet middleware installed.
 * signtool will prompt for the token PIN on first sign operation
 * (subsequent signs within the same session are cached).
 */
function find_signtool() {
    const sdk_root = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
    const sdk_version = '10.0.19041.0'
    const full_path = join(sdk_root, sdk_version, 'x64', 'signtool.exe')
    if (existsSync(full_path)) {
        return full_path
    }
    // fallback: hope it's on PATH
    return 'signtool'
}

const SIGNTOOL = find_signtool()

export default async function sign(configuration) {
    // skip signing in CI — no hardware token available
    if (process.env.CI) {
        console.log(`Skipping code signing in CI: ${configuration.path}`)
        return
    }

    const file_path = configuration.path

    // skip signing non-exe/dll files (e.g. uninstaller stub during nsis build)
    if (!/\.(exe|dll|msi)$/i.test(file_path)) {
        return
    }

    console.log(`Signing: ${file_path}`)
    execFileSync(SIGNTOOL, [
        'sign',
        '/a',                                    // auto-select certificate
        '/tr', 'http://timestamp.sectigo.com',   // RFC 3161 timestamp server
        '/td', 'sha256',                         // timestamp digest algorithm
        '/fd', 'sha256',                         // file digest algorithm
        '/v',                                    // verbose
        file_path,
    ], { stdio: 'inherit' })
}
