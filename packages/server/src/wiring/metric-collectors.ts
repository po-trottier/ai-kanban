import { stat, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { type LocalBlobStore } from '../adapters/blob/local-blob-store.ts'
import { type MetricsCollectors } from '../metrics/metrics.ts'

/**
 * Collectors for the disk gauges (deployment.md#observability): WAL size
 * (checkpoint starvation), blob-dir bytes and volume free space (disk fill).
 * Composed here because filesystem access is confined to the blob adapter
 * and the composition root (docs/dev/standards.md). Blob bytes read the
 * store's O(1) running total — the same number the upload high-water check
 * uses — never a per-scrape directory walk. Every collector degrades to 0
 * instead of throwing: a scrape must never fail because a file is
 * momentarily absent.
 */
export function createMetricCollectors(deps: {
  /** The SQLite file path — WAL + volume gauges; undefined on Postgres (skipped). */
  databasePath: string | undefined
  blobStore: LocalBlobStore
}): MetricsCollectors {
  return {
    async walSizeBytes() {
      if (deps.databasePath === undefined) return 0
      try {
        return (await stat(`${deps.databasePath}-wal`)).size
      } catch {
        return 0
      }
    },
    blobDirBytes: () => deps.blobStore.totalBytes(),
    async volumeFreeBytes() {
      if (deps.databasePath === undefined) return 0
      try {
        // The database directory is the data volume (/data in the image).
        const stats = await statfs(dirname(deps.databasePath))
        return stats.bsize * stats.bavail
      } catch {
        return 0
      }
    },
  }
}
