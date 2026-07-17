// Native modules (better-sqlite3, argon2) are NOT built by `npm ci`: .npmrc
// sets ignore-scripts=true as a supply-chain control, so their compile/download
// step is skipped. This guard runs before `npm run dev` and rebuilds them on
// demand, so a plain clone + `npm ci` + `npm run dev` just works — no one has
// to remember `npm run setup` first. The probe is milliseconds; the rebuild
// only fires when the bindings are actually missing.
import { execSync } from 'node:child_process'

async function canLoad(moduleName, probe) {
  try {
    const mod = await import(moduleName)
    await probe(mod.default ?? mod)
    return true
  } catch {
    return false
  }
}

const ready =
  (await canLoad('better-sqlite3', (Database) => {
    new Database(':memory:').close()
  })) && (await canLoad('argon2', (argon2) => argon2.hash('probe')))

if (!ready) {
  console.log('Native modules not built yet — rebuilding better-sqlite3 and argon2…')
  execSync('npm rebuild --ignore-scripts=false --foreground-scripts better-sqlite3 argon2', {
    stdio: 'inherit',
  })
}
