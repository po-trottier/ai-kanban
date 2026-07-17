import { readdir, stat, statfs } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type MetricsCollectors } from '../metrics/metrics.ts'

/**
 * Filesystem-backed collectors for the disk gauges (deployment.md
 * #observability): WAL size (checkpoint starvation), blob-dir bytes and
 * volume free space (disk fill). Composed here because filesystem access is
 * confined to the blob adapter and the composition root
 * (docs/dev/standards.md). Every collector degrades to 0 instead of throwing:
 * a scrape must never fail because a file is momentarily absent.
 */

async function directoryBytes(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) total += await directoryBytes(path)
      else if (entry.isFile()) total += (await stat(path)).size
    }
    return total
  } catch {
    return 0
  }
}

export function createMetricCollectors(paths: {
  databasePath: string
  blobDir: string
}): MetricsCollectors {
  return {
    async walSizeBytes() {
      try {
        return (await stat(`${paths.databasePath}-wal`)).size
      } catch {
        return 0
      }
    },
    blobDirBytes: () => directoryBytes(paths.blobDir),
    async volumeFreeBytes() {
      try {
        // The database directory is the data volume (/data in the image).
        const stats = await statfs(dirname(paths.databasePath))
        return stats.bsize * stats.bavail
      } catch {
        return 0
      }
    },
  }
}
