/**
 * Trace hook for core modules.
 *
 * Core is shared by the GUI, the CLI, and the library API, so it cannot
 * write to a log file itself -- the host wires a sink instead:
 *
 *   - Electron main: sink -> %APPDATA%/jseeqret/logs/main.log ([trace])
 *   - CLI: sink -> stderr when JSEEQRET_TRACE is set
 *   - library/tests: no sink (calls are no-ops)
 *
 * Tracing exists to answer "where did the flow stop?" in the field --
 * every Slack API interaction and every poll-decision should leave a
 * line. NEVER trace tokens, key material, plaintext secrets, or blob
 * contents (lengths and ids only).
 */

let _sink = null

/** @param {(...parts: any[]) => void | null} fn */
export function set_trace_sink(fn) {
    _sink = fn
}

export function trace(...parts) {
    if (_sink) _sink(...parts)
}
