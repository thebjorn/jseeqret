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

import { get, getSync, init, close } from '../src/core/api.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { getSeeqretDir, isInitialized } from '../src/core/vault.js'

const DURATION_SEC = parseInt(process.argv[2] || '10', 10)

async function findBenchmarkSecret() {
  const storage = new SqliteStorage()
  const secrets = await storage.fetchSecrets({ app: '*', env: '*', key: '*' })
  if (secrets.length > 0) {
    return { app: secrets[0].app, env: secrets[0].env, key: secrets[0].key, cleanup: false }
  }
  // No secrets found — create a temporary one
  const secret = new Secret({
    app: '_bench', env: '_bench', key: '_BENCH_KEY',
    plaintextValue: 'benchmark-value',
  })
  await storage.addSecret(secret)
  return { app: '_bench', env: '_bench', key: '_BENCH_KEY', cleanup: true }
}

async function cleanupBenchmarkSecret() {
  const storage = new SqliteStorage()
  await storage.removeSecrets({ app: '_bench', env: '_bench', key: '_BENCH_KEY' })
}

function formatNumber(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

async function runBenchmark() {
  if (!isInitialized()) {
    console.error('Error: Vault not initialized. Set JSEEQRET or SEEQRET env var.')
    process.exit(1)
  }

  console.log(`Vault: ${getSeeqretDir()}`)
  console.log(`Duration: ${DURATION_SEC}s\n`)

  const target = await findBenchmarkSecret()
  console.log(`Target secret: ${target.app}:${target.env}:${target.key}\n`)

  // ---- Benchmark 1: async get() (includes WASM init on first call) ----
  {
    close() // ensure cold start
    const warmupVal = await get(target.key, target.app, target.env)
    console.log(`Value: ${typeof warmupVal === 'string' && warmupVal.length > 40 ? warmupVal.slice(0, 37) + '...' : warmupVal}`)
    console.log()

    let count = 0
    const end = Date.now() + DURATION_SEC * 1000
    const start = Date.now()
    while (Date.now() < end) {
      // Do batches of 100 to reduce Date.now() overhead
      for (let i = 0; i < 100; i++) {
        await get(target.key, target.app, target.env)
      }
      count += 100
    }
    const elapsed = (Date.now() - start) / 1000
    const rate = count / elapsed
    console.log(`async get():  ${formatNumber(count)} calls in ${elapsed.toFixed(2)}s = ${formatNumber(rate)} gets/sec`)
  }

  // ---- Benchmark 2: getSync() (after init) ----
  {
    await init()
    let count = 0
    const end = Date.now() + DURATION_SEC * 1000
    const start = Date.now()
    while (Date.now() < end) {
      for (let i = 0; i < 100; i++) {
        getSync(target.key, target.app, target.env)
      }
      count += 100
    }
    const elapsed = (Date.now() - start) / 1000
    const rate = count / elapsed
    console.log(`getSync():    ${formatNumber(count)} calls in ${elapsed.toFixed(2)}s = ${formatNumber(rate)} gets/sec`)
  }

  // ---- Benchmark 3: CLI-style (SqliteStorage per call, for comparison) ----
  {
    const { SqliteStorage: S } = await import('../src/core/sqlite-storage.js')
    const { FilterSpec } = await import('../src/core/filter.js')
    const filter = `${target.app}:${target.env}:${target.key}`
    let count = 0
    const end = Date.now() + DURATION_SEC * 1000
    const start = Date.now()
    while (Date.now() < end) {
      const storage = new S()
      const fspec = new FilterSpec(filter)
      const secrets = await storage.fetchSecrets(fspec.toFilterDict())
      secrets[0].getValue()
      count++
    }
    const elapsed = (Date.now() - start) / 1000
    const rate = count / elapsed
    console.log(`CLI-style:    ${formatNumber(count)} calls in ${elapsed.toFixed(2)}s = ${formatNumber(rate)} gets/sec`)
  }

  close()

  if (target.cleanup) {
    await cleanupBenchmarkSecret()
    console.log('\n(Temporary benchmark secret removed)')
  }
}

runBenchmark().catch(err => {
  console.error(err)
  process.exit(1)
})
