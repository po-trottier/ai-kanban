import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client'

/**
 * The process's Prometheus surface (docs/architecture/deployment.md
 * #observability), on its OWN registry — never the prom-client global — so
 * every wired app (production process, each integration-test boot) owns an
 * isolated metric set. Custom families beyond the defaults: HTTP latency per
 * templated route, live SSE clients, MCP tool calls, croner job outcomes +
 * durations, and the disk gauges (WAL size for checkpoint starvation,
 * blob-dir bytes + volume free space for disk fill). The disk gauges read
 * through injected collectors: filesystem access stays in wiring
 * (docs/dev/standards.md), and scrape-time collection means no timers.
 */

export interface MetricsCollectors {
  /** Size of the SQLite `-wal` file in bytes (0 when absent). */
  walSizeBytes(): Promise<number>
  /** Total bytes under BLOB_DIR (0 when absent). */
  blobDirBytes(): Promise<number>
  /** Free bytes on the volume holding the database (0 when unstattable). */
  volumeFreeBytes(): Promise<number>
}

export type Outcome = 'success' | 'error'

export class AppMetrics {
  readonly registry: Registry
  private readonly httpDuration: Histogram<'method' | 'route' | 'status_code'>
  private readonly sseClients: Gauge
  private readonly mcpToolCalls: Counter<'tool' | 'outcome'>
  private readonly jobRuns: Counter<'job' | 'outcome'>
  private readonly jobDuration: Histogram<'job'>

  constructor(collectors: MetricsCollectors) {
    const registry = new Registry()
    this.registry = registry
    collectDefaultMetrics({ register: registry })

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency on the public listener, per templated route.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    })
    this.sseClients = new Gauge({
      name: 'sse_clients',
      help: 'Currently connected SSE stream clients.',
      registers: [registry],
    })
    this.mcpToolCalls = new Counter({
      name: 'mcp_tool_calls_total',
      help: 'MCP tool invocations by tool name and outcome.',
      labelNames: ['tool', 'outcome'],
      registers: [registry],
    })
    this.jobRuns = new Counter({
      name: 'job_runs_total',
      help: 'Scheduled (croner) job runs by job name and outcome.',
      labelNames: ['job', 'outcome'],
      registers: [registry],
    })
    this.jobDuration = new Histogram({
      name: 'job_duration_seconds',
      help: 'Scheduled (croner) job run duration.',
      labelNames: ['job'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
      registers: [registry],
    })

    const collectedGauge = (name: string, help: string, read: () => Promise<number>): void => {
      new Gauge({
        name,
        help,
        registers: [registry],
        async collect() {
          this.set(await read())
        },
      })
    }
    collectedGauge(
      'sqlite_wal_size_bytes',
      'Size of the SQLite write-ahead log — growth means checkpoint starvation.',
      () => collectors.walSizeBytes(),
    )
    collectedGauge('blob_dir_size_bytes', 'Total bytes stored under BLOB_DIR.', () =>
      collectors.blobDirBytes(),
    )
    collectedGauge(
      'data_volume_free_bytes',
      'Free bytes on the volume holding the database and blobs.',
      () => collectors.volumeFreeBytes(),
    )
  }

  observeHttpRequest(method: string, route: string, statusCode: number, seconds: number): void {
    this.httpDuration.observe(
      { method, route, status_code: String(statusCode) },
      Math.max(seconds, 0),
    )
  }

  sseStreamOpened(): void {
    this.sseClients.inc()
  }

  sseStreamClosed(): void {
    this.sseClients.dec()
  }

  mcpToolCalled(tool: string, outcome: Outcome): void {
    this.mcpToolCalls.inc({ tool, outcome })
  }

  jobCompleted(job: string, outcome: Outcome, seconds: number): void {
    this.jobRuns.inc({ job, outcome })
    this.jobDuration.observe({ job }, Math.max(seconds, 0))
  }
}
