#!/usr/bin/env node

/**
 * Benchmark: measures gets/second for jseeqret API.
 *
 * Usage:
 *   node bench/get-benchmark.js [duration_seconds]
 *
 * Requires JSEEQRET or SEEQRET env var pointing to a vault with at least one secret.
 * If no secrets exist, a temporary one is created and removed after the benchmark.
 */

import { get, get_sync, init, close } from '../src/core/api.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { get_seeqret_dir, is_initialized } from '../src/core/vault.js'

const DURATION_SEC = parseInt(process.argv[2] || '10', 10)

async function find_benchmark_secret() {
    const storage = new SqliteStorage()
    const secrets = await storage.fetch_secrets({ app: '*', env: '*', key: '*' })

    if (secrets.length > 0) {
        return { app: secrets[0].app, env: secrets[0].env, key: secrets[0].key, cleanup: false }
    }

    // No secrets found -- create a temporary one
    const secret = new Secret({
        app: '_bench', env: '_bench', key: '_BENCH_KEY',
        plaintext_value: 'benchmark-value',
    })
    await storage.add_secret(secret)
    return { app: '_bench', env: '_bench', key: '_BENCH_KEY', cleanup: true }
}

async function cleanup_benchmark_secret() {
    const storage = new SqliteStorage()
    await storage.remove_secrets({ app: '_bench', env: '_bench', key: '_BENCH_KEY' })
}

function format_number(n) {
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

async function run_benchmark() {
    if (!is_initialized()) {
        console.error('Error: Vault not initialized. Set JSEEQRET or SEEQRET env var.')
        process.exit(1)
    }

    console.log(`Vault: ${get_seeqret_dir()}`)
    console.log(`Duration: ${DURATION_SEC}s\n`)

    const target = await find_benchmark_secret()
    console.log(`Target secret: ${target.app}:${target.env}:${target.key}\n`)

    // ---- Benchmark 1: async get() (includes WASM init on first call) ----
    {
        close()
        const warmup_val = await get(target.key, target.app, target.env)
        console.log(`Value: ${typeof warmup_val === 'string' && warmup_val.length > 40 ? warmup_val.slice(0, 37) + '...' : warmup_val}`)
        console.log()

        let count = 0
        const end = Date.now() + DURATION_SEC * 1000
        const start = Date.now()

        while (Date.now() < end) {
            for (let i = 0; i < 100; i++) {
                await get(target.key, target.app, target.env)
            }
            count += 100
        }

        const elapsed = (Date.now() - start) / 1000
        const rate = count / elapsed
        console.log(`async get():  ${format_number(count)} calls in ${elapsed.toFixed(2)}s = ${format_number(rate)} gets/sec`)
    }

    // ---- Benchmark 2: get_sync() (after init) ----
    {
        await init()
        let count = 0
        const end = Date.now() + DURATION_SEC * 1000
        const start = Date.now()

        while (Date.now() < end) {
            for (let i = 0; i < 100; i++) {
                get_sync(target.key, target.app, target.env)
            }
            count += 100
        }

        const elapsed = (Date.now() - start) / 1000
        const rate = count / elapsed
        console.log(`get_sync():   ${format_number(count)} calls in ${elapsed.toFixed(2)}s = ${format_number(rate)} gets/sec`)
    }

    // ---- Benchmark 3: CLI-style (SqliteStorage per call, for comparison) ----
    {
        const { FilterSpec } = await import('../src/core/filter.js')
        const filter = `${target.app}:${target.env}:${target.key}`
        let count = 0
        const end = Date.now() + DURATION_SEC * 1000
        const start = Date.now()

        while (Date.now() < end) {
            const storage = new SqliteStorage()
            const fspec = new FilterSpec(filter)
            const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
            secrets[0].get_value()
            count++
        }

        const elapsed = (Date.now() - start) / 1000
        const rate = count / elapsed
        console.log(`CLI-style:    ${format_number(count)} calls in ${elapsed.toFixed(2)}s = ${format_number(rate)} gets/sec`)
    }

    close()

    if (target.cleanup) {
        await cleanup_benchmark_secret()
        console.log('\n(Temporary benchmark secret removed)')
    }
}

run_benchmark().catch(err => {
    console.error(err)
    process.exit(1)
})
