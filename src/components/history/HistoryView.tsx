"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { keepReview } from "@/lib/review/kept";
import { clearHistory, deleteHistory, isHistoryAvailable, listHistory, saveHistory } from "@/lib/history/store";
import { exportFile, exportFileName, mergeImported, parseImport, type ImportResult } from "@/lib/history/transfer";
import type { HistoryRecord } from "@/lib/history/types";
import { CLASS_INFO } from "@/lib/review/classify";

/** Refusing a file too big to even read: the same cap parseImport applies to the text. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** The visit is noted when the game is opened (out here, so render stays pure). */
const opened = (rec: HistoryRecord): HistoryRecord => ({ ...rec, lastOpenedAt: Date.now() });

/** The export file's moment in time (same reason). */
const now = () => Date.now();

const IMPORT_REASONS: Record<Exclude<ImportResult, { ok: true }>["reason"], string> = {
  unreadable: "That file couldn't be read. Is it the history file this page exports?",
  "not-history": "That file isn't a history file this page exports.",
  "newer-version": "That file was exported by a newer version. Update the site and try again.",
  "too-large": "That file is too large to import.",
};

export function HistoryView() {
  const router = useRouter();
  // null while the list is being read; [] when the history is empty.
  const [records, setRecords] = useState<HistoryRecord[] | null>(null);
  // The store is asked once, after the page has mounted: the server has no IndexedDB, so
  // the answer can't be part of the first render.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    queueMicrotask(() => {
      void listHistory().then((rs) => {
        setRecords(rs);
        void navigator.storage
          ?.estimate?.()
          .then((e) => e.usage != null && setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB of site data`))
          .catch(() => undefined);
      });
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => setAvailable(isHistoryAvailable()));
    refresh();
  }, [refresh]);

  /** Opening a game from the history: the tab keeps it, and the review page shows it again, engine skipped. */
  const open = (rec: HistoryRecord) => {
    keepReview({ pgn: rec.pgn, ...(rec.as ? { as: rec.as } : {}), depth: rec.depth, ...(rec.data ? { data: rec.data } : {}) });
    void saveHistory(opened(rec));
    router.push("/review");
  };

  const remove = (rec: HistoryRecord) => {
    void deleteHistory(rec.id).then(refresh);
  };

  const clear = () => {
    setConfirming(false);
    void clearHistory().then(refresh);
  };

  const exportAll = () => {
    if (!records?.length) return;
    const at = now();
    const url = URL.createObjectURL(new Blob([exportFile(records, at)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(at);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setNote(IMPORT_REASONS["too-large"]);
      return;
    }
    const back = await parseImport(await file.text());
    if (!back.ok) {
      setNote(IMPORT_REASONS[back.reason]);
      return;
    }
    const existing = await listHistory();
    const { changed, added, skipped } = mergeImported(existing, back.records);
    for (const rec of changed) await saveHistory(rec);
    refresh();
    setNote(`Added ${added}${skipped ? `, skipped ${skipped} already here` : ""}${back.rejected ? `, ${back.rejected} couldn't be read` : ""}.`);
  };

  const filtered = useMemo(() => {
    if (!records) return null;
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => `${r.summary.white} ${r.summary.black} ${r.summary.opening?.name ?? ""}`.toLowerCase().includes(q));
  }, [records, query]);

  if (available === false) {
    return (
      <section className="section">
        <h1 className="h-section">History</h1>
        <p className="section-lede">History can&apos;t be saved in this browser. Private windows often block it. You can still review games.</p>
      </section>
    );
  }

  return (
    <section className="section">
      <h1 className="h-section">History</h1>
      <p className="section-lede">The games this browser has reviewed. Saved in this browser only; export a file to keep a copy or move it.</p>

      {filtered && (
        <div className="history-tools">
          <input className="input history-search" type="search" placeholder="Search players or opening" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the history" />
          <button className="btn btn-sm" onClick={exportAll} disabled={!filtered.length}>
            Export
          </button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
          {confirming ? (
            <span className="history-confirm">
              Clear everything?
              <button className="btn btn-sm" onClick={clear}>
                Yes, clear
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)} disabled={!filtered.length}>
              Clear history
            </button>
          )}
        </div>
      )}

      {note && (
        <p className="history-note" role="status">
          {note}
        </p>
      )}

      {!filtered ? (
        <p className="section-lede" aria-live="polite">
          Loading…
        </p>
      ) : !filtered.length ? (
        <p className="section-lede">No reviewed games yet. Review a game and it shows up here.</p>
      ) : (
        <ul className="history-list">
          {filtered.map((rec) => (
            <HistoryRow key={rec.id} rec={rec} onOpen={() => open(rec)} onDelete={() => remove(rec)} />
          ))}
        </ul>
      )}

      <p className="history-usage">
        {filtered?.length ?? 0} {filtered?.length === 1 ? "game" : "games"}
        {usage ? ` · ${usage} in this browser` : ""}
      </p>
    </section>
  );
}

function HistoryRow({ rec, onOpen, onDelete }: { rec: HistoryRecord; onOpen: () => void; onDelete: () => void }) {
  const s = rec.summary;
  const as = rec.as ?? null;
  const accuracy = (c: "w" | "b") => (s.accuracy[c] == null ? null : Math.round(s.accuracy[c]));
  // A compact count of the labels that matter, for the side the game was viewed from.
  const counts = (["brilliant", "mistake", "blunder"] as const).flatMap((cls) => {
    const n = as ? s.counts[cls]?.[as] ?? 0 : 0;
    return n ? [`${n} ${CLASS_INFO[cls].label.toLowerCase()}`] : [];
  });
  const date = s.playedOn ?? new Date(rec.reviewedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <li className="history-row">
      <div className="history-main">
        <p className="history-players">
          <span className={`history-side${as === "w" ? " history-as" : ""}`}>{s.white}</span>
          {s.whiteElo ? <span className="history-elo">{s.whiteElo}</span> : null}
          <span className="history-vs">vs</span>
          <span className={`history-side${as === "b" ? " history-as" : ""}`}>{s.black}</span>
          {s.blackElo ? <span className="history-elo">{s.blackElo}</span> : null}
          <span className="history-result mono">{s.result}</span>
        </p>
        <p className="history-facts">
          {s.opening?.name ? <span className="history-opening">{s.opening.name}</span> : null}
          <span className="history-acc">
            <span className="history-side">White</span> {accuracy("w") ?? "–"}% · <span className="history-side">Black</span> {accuracy("b") ?? "–"}%
          </span>
          {counts.length ? <span className="history-counts">{counts.join(" · ")}</span> : null}
          <span className="history-date">{date}</span>
        </p>
      </div>
      <div className="history-actions">
        <button className="btn btn-sm btn-primary" onClick={onOpen}>
          Open
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onDelete} aria-label={`Delete ${s.white} vs ${s.black} from the history`}>
          Delete
        </button>
      </div>
    </li>
  );
}
