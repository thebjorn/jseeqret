/**
 * Cross-platform browser opener. Avoids a dep on the `open` package for
 * the common case of "launch the default browser with a URL".
 */

import { spawn } from 'child_process'

/**
 * Open `url` in the operating system's default browser. Falls back to
 * printing the URL if the spawn fails.
 * @param {string} url
 */
export async function open(url) {
    const plat = process.platform

    let cmd, args
    if (plat === 'win32') {
        // rundll32 avoids cmd.exe quoting headaches around `&` in URLs.
        cmd = 'rundll32'
        args = ['url.dll,FileProtocolHandler', url]
    } else if (plat === 'darwin') {
        cmd = 'open'
        args = [url]
    } else {
        cmd = 'xdg-open'
        args = [url]
    }

    try {
        const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
        child.unref()
        console.log(`Opened browser: ${url}`)
    } catch (e) {
        console.log(`Open this URL in your browser:\n  ${url}`)
    }
}
