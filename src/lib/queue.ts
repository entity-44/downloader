import { log } from "./log";

/** Small in-process job queue with bounded concurrency. */
export class JobQueue {
  private running = 0;
  private pending: Array<() => Promise<void>> = [];
  private idleResolvers: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  add(name: string, job: () => Promise<void>) {
    this.pending.push(async () => {
      try {
        await job();
      } catch (e) {
        log.error("Background job failed", { job: name, error: e });
      }
    });
    this.next();
  }

  private next() {
    while (this.running < this.concurrency && this.pending.length) {
      const job = this.pending.shift()!;
      this.running++;
      job().finally(() => {
        this.running--;
        this.next();
        if (this.running === 0 && this.pending.length === 0) this.idleResolvers.splice(0).forEach((r) => r());
      });
    }
  }

  /** Resolves when no jobs are running or queued (used by tests). */
  onIdle(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleResolvers.push(r));
  }
}

const g = globalThis as unknown as { __queues?: { downloads: JobQueue; archives: JobQueue } };
export function queues() {
  g.__queues ??= { downloads: new JobQueue(2), archives: new JobQueue(1) };
  return g.__queues;
}
