import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type BlobStorePort } from '@rivian-kanban/core'

/**
 * Local-disk BlobStorePort adapter (docs/architecture/security.md#uploads):
 * blobs live under BLOB_DIR named by server-generated UUID keys — the
 * original filename never touches the filesystem, so there is no traversal
 * surface. The only module (besides wiring/CLI) allowed to touch `node:fs`
 * (dependency-cruiser rule).
 */

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class LocalBlobStore implements BlobStorePort {
  private readonly dir: string
  /** Running byte total, maintained by put/delete after one boot-time scan. */
  private total: number

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    this.total = this.scanTotal()
  }

  /** Defense in depth: keys are UUIDs by construction; anything else is a bug. */
  private pathOf(key: string): string {
    if (!UUID_KEY.test(key)) throw new Error(`invalid blob key: ${key}`)
    return join(this.dir, key)
  }

  /** One synchronous scan at construction — never per-request (O(blobs)). */
  private scanTotal(): number {
    let total = 0
    for (const entry of readdirSync(this.dir)) {
      if (!UUID_KEY.test(entry)) continue
      const info = statSync(join(this.dir, entry))
      if (info.isFile()) total += info.size
    }
    return total
  }

  async put(key: string, content: Uint8Array): Promise<void> {
    await writeFile(this.pathOf(key), content, { flag: 'wx' })
    this.total += content.byteLength
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.pathOf(key))
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathOf(key)
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      return // already gone — force-delete semantics
    }
    await rm(path, { force: true })
    this.total -= size
  }

  /** Total stored bytes — the BLOB_DIR high-water check reads this. */
  totalBytes(): Promise<number> {
    return Promise.resolve(this.total)
  }
}
