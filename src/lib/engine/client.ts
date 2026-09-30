/**
 * Engine client: speaks UCI to a Stockfish-compatible engine over an abstract
 * transport (a Web Worker in the browser, a fake or Node build in tests).
 *
 * Searches run one at a time. `analyze` returns a cancellable handle; cancelling
 * sends `stop` and resolves with whatever the engine had found so far.
 */
import type { Color } from "../chess/types";
import { normalizeScore, type Evaluation } from "./score";
import { parseFinalEval } from "./pieceValues";
import { parseBestMove, parseInfoLine } from "./uci";

export interface EngineTransport {
  post(command: string): void;
  onLine(cb: (line: string) => void): void;
  onError(cb: (message: string) => void): void;
  terminate(): void;
}

export interface SearchOptions {
  fen: string;
  multipv: number;
  /** Search limit: exactly one of depth or movetimeMs. */
  depth?: number;
  movetimeMs?: number;
  /** Restrict the search to these UCI moves (for "why not this move?"). */
  searchmoves?: string[];
  /** Run the static `eval` command instead of a search. */
  staticEval?: boolean;
}

export interface EngineLine {
  multipv: number;
  depth: number;
  eval: Evaluation;
  pv: string[];
}

export interface AnalysisSnapshot {
  fen: string;
  depth: number;
  lines: EngineLine[];
  nodes?: number;
  nps?: number;
  elapsedMs: number;
  done: boolean;
  cancelled?: boolean;
  bestMove: string | null;
  /** Static evaluation (White's view, pawns) for `staticEval` jobs; null if the engine declined (e.g. in check). */
  staticEval?: number | null;
}

export interface SearchHandle {
  promise: Promise<AnalysisSnapshot>;
  cancel(): void;
}

interface Job {
  opts: SearchOptions;
  sideToMove: Color;
  onUpdate?: (s: AnalysisSnapshot) => void;
  resolve: (s: AnalysisSnapshot) => void;
  reject: (e: Error) => void;
  lines: Map<number, EngineLine>;
  depth: number;
  nodes?: number;
  nps?: number;
  started: number;
  cancelled: boolean;
  lastEmit: number;
  phase: "queued" | "syncing" | "searching";
}

export class EngineError extends Error {}

export class EngineClient {
  private transport: EngineTransport;
  private waiters: { token: string; resolve: () => void }[] = [];
  private queue: Job[] = [];
  private active: Job | null = null;
  private failed: string | null = null;
  readonly ready: Promise<void>;
  name = "Stockfish";

  constructor(transport: EngineTransport, { initTimeoutMs = 20_000 } = {}) {
    this.transport = transport;
    transport.onLine((line) => this.handleLine(line));
    transport.onError((message) => this.fail(message));
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const msg = "The engine didn't start in time. Your browser may be blocking WebAssembly.";
        this.fail(msg);
        reject(new EngineError(msg));
      }, initTimeoutMs);
      this.waitFor("uciok")
        .then(() => {
          this.transport.post("isready");
          return this.waitFor("readyok");
        })
        .then(() => {
          clearTimeout(timer);
          resolve();
        }, reject);
      this.transport.post("uci");
    });
    // Avoid unhandled rejections when nobody awaits `ready` directly.
    this.ready.catch(() => undefined);
  }

  get error(): string | null {
    return this.failed;
  }

  analyze(opts: SearchOptions, onUpdate?: (s: AnalysisSnapshot) => void): SearchHandle {
    let job!: Job;
    const promise = new Promise<AnalysisSnapshot>((resolve, reject) => {
      const turn = opts.fen.split(" ")[1];
      job = {
        opts,
        sideToMove: turn === "b" ? "b" : "w",
        onUpdate,
        resolve,
        reject,
        lines: new Map(),
        depth: 0,
        started: 0,
        cancelled: false,
        lastEmit: 0,
        phase: "queued",
      };
    });
    if (this.failed) {
      job.reject(new EngineError(this.failed));
    } else {
      this.queue.push(job);
      this.ready.then(() => this.pump(), (e) => job.reject(e));
    }
    return { promise, cancel: () => this.cancel(job) };
  }

  /** Static NNUE evaluation of a position, in pawns from White's view (null if unavailable). */
  staticEval(fen: string): Promise<number | null> {
    return this.analyze({ fen, multipv: 1, staticEval: true }).promise.then((s) => s.staticEval ?? null);
  }

  /** Cancels every queued and running search. */
  cancelAll(): void {
    for (const job of [...this.queue]) this.cancel(job);
    if (this.active) this.cancel(this.active);
  }

  terminate(): void {
    this.cancelAll();
    this.transport.terminate();
    this.fail("The engine was shut down.");
  }

  private cancel(job: Job) {
    if (job.cancelled) return;
    job.cancelled = true;
    const idx = this.queue.indexOf(job);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      job.resolve(this.snapshot(job, true));
      return;
    }
    if (this.active === job && job.phase === "searching" && !job.opts.staticEval) this.transport.post("stop");
    // A job still syncing is stopped right after its `go` is sent (see pump).
  }

  private async pump() {
    if (this.active || this.failed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;
    job.phase = "syncing";
    const { opts } = job;
    this.transport.post(`setoption name MultiPV value ${Math.max(1, Math.min(5, opts.multipv))}`);
    this.transport.post(`position fen ${opts.fen}`);
    this.transport.post("isready");
    await this.waitFor("readyok");
    if (this.failed) return;
    job.started = Date.now();
    job.phase = "searching";
    if (opts.staticEval) {
      this.transport.post("eval");
      return;
    }
    const limit = opts.movetimeMs ? `movetime ${Math.round(opts.movetimeMs)}` : `depth ${opts.depth ?? 16}`;
    const moves = opts.searchmoves?.length ? ` searchmoves ${opts.searchmoves.join(" ")}` : "";
    this.transport.post(`go ${limit}${moves}`);
    if (job.cancelled) this.transport.post("stop");
  }

  private handleLine(line: string) {
    if (typeof line !== "string") return;
    for (let i = 0; i < this.waiters.length; i++) {
      if (line.startsWith(this.waiters[i].token)) {
        const [w] = this.waiters.splice(i, 1);
        w.resolve();
        return;
      }
    }
    const job = this.active;
    if (!job || job.phase !== "searching") return;
    if (job.opts.staticEval) {
      const v = parseFinalEval(line);
      if (v === undefined) return;
      this.active = null;
      job.resolve({ ...this.snapshot(job, true), staticEval: v });
      void this.pump();
      return;
    }
    const info = parseInfoLine(line);
    if (info) {
      if (info.bound) return;
      job.depth = Math.max(job.depth, info.depth);
      job.nodes = info.nodes ?? job.nodes;
      job.nps = info.nps ?? job.nps;
      job.lines.set(info.multipv, {
        multipv: info.multipv,
        depth: info.depth,
        eval: normalizeScore(info.score, job.sideToMove),
        pv: info.pv,
      });
      const now = Date.now();
      if (job.onUpdate && now - job.lastEmit > 120) {
        job.lastEmit = now;
        job.onUpdate(this.snapshot(job, false));
      }
      return;
    }
    const best = parseBestMove(line);
    if (best) {
      this.active = null;
      const snap = { ...this.snapshot(job, true), bestMove: best.best };
      job.onUpdate?.(snap);
      job.resolve(snap);
      void this.pump();
    }
  }

  private snapshot(job: Job, done: boolean): AnalysisSnapshot {
    // Only report lines from the deepest completed iteration consistently: a line
    // from depth d-1 next to one from depth d is fine for display but sort by rank.
    const lines = [...job.lines.values()].sort((a, b) => a.multipv - b.multipv);
    return {
      fen: job.opts.fen,
      depth: job.depth,
      lines,
      nodes: job.nodes,
      nps: job.nps,
      elapsedMs: job.started ? Date.now() - job.started : 0,
      done,
      cancelled: job.cancelled || undefined,
      bestMove: lines[0]?.pv[0] ?? null,
    };
  }

  private waitFor(token: string): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ token, resolve }));
  }

  private fail(message: string) {
    if (this.failed) return;
    this.failed = message;
    const err = new EngineError(message);
    if (this.active) this.active.reject(err);
    for (const job of this.queue) job.reject(err);
    this.active = null;
    this.queue = [];
    // Release anyone waiting on handshake tokens so async flows can observe `failed`.
    for (const w of this.waiters) w.resolve();
    this.waiters = [];
  }
}

/** Browser transport: the Stockfish.js build doubles as a Web Worker script. */
export function createWorkerTransport(url = "/engine/stockfish.js"): EngineTransport {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    throw new EngineError("This browser can't run the engine (Web Workers or WebAssembly are unavailable).");
  }
  const worker = new Worker(url);
  let onError: (m: string) => void = () => undefined;
  worker.addEventListener("error", (e) => {
    e.preventDefault();
    onError(e.message ? `Engine error: ${e.message}` : "The engine failed to load.");
  });
  return {
    post: (cmd) => worker.postMessage(cmd),
    onLine: (cb) =>
      worker.addEventListener("message", (e: MessageEvent) => {
        if (typeof e.data === "string") cb(e.data);
      }),
    onError: (cb) => {
      onError = cb;
    },
    terminate: () => worker.terminate(),
  };
}
