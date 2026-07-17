import { mkdirSync, readdirSync, statSync, type ReadStream } from 'node:fs'
import { open, rm, stat, writeFile } from 'node:fs/promises'
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
  /** Bytes held by in-flight uploads (reserve-then-settle, like UploadQuota). */
  private reserved = 0

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    this.total = this.scanTotal()
  }

  /**
   * Atomically checks AND holds `bytes` of headroom under the high-water
   * mark: the synchronous check+add cannot interleave with another request's,
   * so N concurrent uploads cannot all pass a read-then-write totalBytes
   * check (TOCTOU) and overshoot the global disk cap. Callers `release` once
   * settled — on success put() moved the bytes into the stored total.
   */
  reserve(bytes: number, highWaterBytes: number): boolean {
    if (this.total + this.reserved + bytes > highWaterBytes) return false
    this.reserved += bytes
    return true
  }

  /** Releases a reservation once the upload settled (clamped at zero). */
  release(bytes: number): void {
    this.reserved = Math.max(0, this.reserved - bytes)
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

  /**
   * Streaming read for the download route (beyond the BlobStorePort surface —
   * core never reads blobs): O(1) memory per request instead of buffering a
   * 25 MB blob per concurrent download. Opening the handle first turns a
   * missing blob into `null` (→ 404) rather than a mid-response stream error;
   * the stream closes the handle itself (autoClose).
   */
  async getStream(key: string): Promise<ReadStream | null> {
    try {
      const handle = await open(this.pathOf(key), 'r')
      return handle.createReadStream()
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
