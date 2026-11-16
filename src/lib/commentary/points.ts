/**
 * What each side likes about its position and what it doesn't: the handful of things a
 * strong player would name first, each with why it matters in this position. A feature is
 * only reported when it has consequences here (a weak pawn on a file the other side can use,
 * a king short of cover while the attackers are still on the board), and what counts changes
 * with the phase.
 */
import { attackersOf, fileIndex, isLightSquare, rankIndex, toSquare } from "../chess/board";
import { COLOR_NAME, PIECE_NAME, other, type Color, type Square } from "../chess/types";
import { fileState, isOutpost, ownBlockers } from "../facts/activity";
import type { PositionFacts } from "../facts";
import { emptyMarks, type Marks } from "../facts/types";
import { fileLetter, materialWords, rel, relSquare, wingOfFile, type Features, type Wing } from "./features";
import type { Structure } from "./structures";
import type { Point, Theme } from "./types";

/** Capitalises a sentence start, but never a square or a move ("e4", "…c5"). */
export const cap = (s: string) => (/^(…|[a-h][1-8])/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1));
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const num = (n: number) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"][n] ?? String(n);
const dist = (a: Square, b: Square) => Math.max(Math.abs(fileIndex(a) - fileIndex(b)), Math.abs(rankIndex(a) - rankIndex(b)));
const CENTRE: Square[] = ["d4", "d5", "e4", "e5"];
const toCentre = (sq: Square) => Math.min(...CENTRE.map((c) => dist(sq, c)));

/** The same material balance from the other side: "a pawn up" → "a pawn down", "a queen for a knight" → "a knight for a queen". */
export function downWords(up: string): string {
  if (up.endsWith(" up")) return up.replace(/ up$/, " down");
  const m = up.match(/^(the exchange|a piece) for (.+)$/);
  if (m) return `${m[1]} down, for ${m[2]}`;
  const swap = up.match(/^(.+) for (.+)$/);
  return swap ? `${swap[2]} for ${swap[1]}` : up;
}

export const pieceAt = (f: Features, sq: Square) => {
  const x = f.p[sq];
  return x ? (x.type === "p" ? `the ${sq} pawn` : `the ${PIECE_NAME[x.type]} on ${sq}`) : sq;
};

const marks = (m: Partial<Marks>): Marks => ({ ...emptyMarks(), ...m });

interface Draft {
  side: Color;
  good: boolean;
  theme: Theme;
  key: string;
  title: string;
  text: string;
  marks?: Partial<Marks>;
  weight: number;
  evidence?: Point["evidence"];
}

/** How a king is doing, for the points here and the plans built on them. */
export interface KingRead {
  side: Color;
  /** "stuck": can't castle; "uncastled": still can; "thin": castled with cover missing; "attacked": outnumbered; null: fine. */
  problem: "stuck" | "uncastled" | "thin" | "attacked" | null;
  attackers: Square[];
  defenders: Square[];
  openFiles: number[];
  weight: number;
}

export function readKing(f: Features, c: Color): KingRead {
  const me = f.of(c);
  const them = f.of(other(c));
  const none: KingRead = { side: c, problem: null, attackers: me.kingAttackers, defenders: me.kingDefenders, openFiles: me.openAtKing, weight: 0 };
  // Without queens, or with almost nothing left to attack with, the king isn't the story.
  if (f.phase === "endgame" || (!them.counts.q && them.pieces < 13)) return none;
  const heavy = (file: number) => [...them.rooks, ...them.queens].some((s) => fileIndex(s) === file);
  const openUsed = me.openAtKing.filter((file) => heavy(file) || !fileState(f.p, file)[them.color]);
  if (!me.castled && me.kingWing === "centre" && f.fullmove >= 8 && them.counts.q) {
    const can = me.canCastle.k || me.canCastle.q;
    const openCentre = f.centre.kind === "open" || f.centre.kind === "tension" || !fileState(f.p, fileIndex(me.king))[c];
    if (!can) return { ...none, problem: "stuck", openFiles: openUsed, weight: 62 + (openCentre ? 14 : 0) + 4 * me.kingAttackers.length };
    if (them.castled && openCentre) return { ...none, problem: "uncastled", openFiles: openUsed, weight: 40 + 4 * me.kingAttackers.length };
    return none;
  }
  const a = me.kingAttackers.length;
  const d = me.kingDefenders.length;
  if (a >= 3 && a > d) return { ...none, problem: "attacked", openFiles: openUsed, weight: 60 + 6 * (a - d) + 6 * openUsed.length };
  // Thin cover only matters if enough is aimed at it: at least as many attackers as defenders, give or take one.
  if (me.castled && them.counts.q && a >= 2 && a >= d - 1 && (me.shelter.length <= 1 || (openUsed.length && me.shelter.length <= 2))) return { ...none, problem: "thin", openFiles: openUsed, weight: 34 + 8 * a + 8 * openUsed.length };
  return none;
}

/**
 * A bad bishop: two or more of its own centre pawns are rammed against enemy pawns on its
 * colour, they stand in front of it, and it does little from where it is. The pawns, or null.
 */
export function badBishop(f: Features, sq: Square): Square[] | null {
  const b = f.p[sq];
  if (!b || b.type !== "b") return null;
  const me = f.of(b.color);
  const o = other(b.color);
  const fixed = me.pawns
    .map((x) => x.sq)
    .filter((s) => {
      const file = fileIndex(s);
      if (file < 2 || file > 5 || isLightSquare(s) !== isLightSquare(sq)) return false;
      const front = relSquare(file, rel(s, b.color) + 1, b.color);
      return !!front && f.p[front]?.type === "p" && f.p[front]!.color === o;
    });
  if (fixed.length < 2) return null;
  const act = me.activity.find((x) => x.sq === sq);
  // A bishop already outside its pawns, or one that presses on something, isn't bad whatever the pawns do.
  const ahead = fixed.filter((s) => rel(s, b.color) > rel(sq, b.color)).length;
  if (!act || act.score >= 0.6 || ahead < 2) return null;
  return fixed;
}

/** Squares from which `c` controls a file's entry point: the rooks and queens it has on an open file nobody contests. */
function ownedOpenFiles(f: Features, c: Color): { file: number; pieces: Square[] }[] {
  const me = f.of(c);
  const them = f.of(other(c));
  return f.openFiles
    .map((file) => ({ file, pieces: [...me.rooks, ...me.queens].filter((s) => fileIndex(s) === file) }))
    .filter((x) => x.pieces.some((s) => f.p[s]!.type === "r") && ![...them.rooks, ...them.queens].some((s) => fileIndex(s) === x.file));
}

/**
 * A pawn that is stuck as a target: not passed, on a file the other side's rooks can use,
 * with no pawn of its own that can ever stand beside or behind it, and unable to advance
 * safely (an enemy pawn covers the square in front, or enemy pieces cover it more often
 * than its own side does). "Isolated" when no pawn is on the files beside it at all.
 */
export function weakPawns(f: Features, c: Color): { sq: Square; isolated: boolean; vulnerable: boolean }[] {
  const me = f.of(c);
  const o = other(c);
  return me.pawns
    .filter((x) => {
      if (x.passed || fileState(f.p, fileIndex(x.sq))[o]) return false;
      if (x.isolated || x.backward) return true;
      const file = fileIndex(x.sq);
      const r = rel(x.sq, c);
      const helper = me.pawns.some((y) => Math.abs(fileIndex(y.sq) - file) === 1 && rel(y.sq, c) <= r);
      if (helper) return false;
      const front = relSquare(file, r + 1, c);
      return !!front && attackersOf(f.p, front, o).length > attackersOf(f.p, front, c).length;
    })
    .map((x) => ({ sq: x.sq, isolated: x.isolated, vulnerable: x.vulnerable }));
}

/** What the engine has said so far, for the points that depend on it. */
export interface EngineHint {
  /** The first move of the engine's best line. */
  first?: { from: Square; to: Square };
  /** The game is decided (a forced mate, or an advantage nothing short of a blunder changes). */
  decided?: boolean;
}

/** `engine`: once the engine has spoken, a piece only counts as loose if its best line treats it that way. */
export function sidePoints(f: Features, structures: Structure[], facts: PositionFacts, engine?: EngineHint): Record<Color, { likes: Point[]; dislikes: Point[] }> {
  const checked = !!engine;
  const drafts: Draft[] = [];
  const add = (d: Draft) => drafts.push(d);
  const N = (c: Color) => COLOR_NAME[c];
  const endish = f.phase === "endgame" || f.phase === "queenless";
  const openish = f.centre.kind === "open" || f.centre.kind === "semi-open" || f.centre.kind === "tension" || f.centre.kind === "mobile";

  // Material.
  const mw = materialWords(f);
  if (mw && mw.points >= 1) {
    const up = mw.side;
    const down = other(up);
    const big = mw.points >= 3;
    const exchange = /exchange/.test(mw.text);
    add({
      side: up,
      good: true,
      theme: "material",
      key: "material",
      title: cap(mw.text),
      text: exchange
        ? `A rook for a minor piece. The rook shows it once files open and the other pieces come off, so both suit ${N(up)}.`
        : big
          ? `With this much extra, every trade of pieces helps: the fewer pieces left, the less ${N(down)} can stir up.`
          : f.phase === "endgame"
            ? `Endgames are won with an extra pawn. The aim is to turn it into a passed pawn and make ${N(down)} give something up to stop it.`
            : `It counts for more with every piece that comes off, so trading pieces suits ${N(up)} and trading pawns doesn't.`,
      weight: Math.min(92, 52 + 9 * mw.points),
    });
    add({
      side: down,
      good: false,
      theme: "material",
      key: "material",
      title: cap(downWords(mw.text)),
      text: big
        ? `The position has to give something back quickly: an attack, a perpetual, a passed pawn. Quiet play loses.`
        : `Something has to make up for it: more active pieces, an attack, or the pawn won back. Keep pieces on and trade pawns; a simpler position favours ${N(up)}.`,
      weight: Math.min(92, 50 + 9 * mw.points),
    });
  }

  for (const c of ["w", "b"] as Color[]) {
    const me = f.of(c);
    const them = f.of(other(c));
    const o = other(c);

    // The bishop pair.
    if (me.bishopPair && !them.bishopPair) {
      const against = them.bishops.length ? "a bishop and a knight" : them.knights.length >= 2 ? "two knights" : them.knights.length ? "a knight" : "no minor pieces";
      add({
        side: c,
        good: true,
        theme: "material",
        key: "bishop-pair",
        title: "The bishop pair",
        text: openish || endish
          ? `Two bishops against ${against}. Between them they reach every square from a distance, and the more the board empties, the more that tells.`
          : `Two bishops against ${against}, though with the centre blocked they don't have their diagonals yet. Opening the position is in ${N(c)}'s interest; keeping it shut is in ${N(o)}'s.`,
        marks: { squares: me.bishops.map((sq) => ({ sq, tone: "opportunity" as const, style: "ring" as const })) },
        weight: openish || endish ? 44 : 24,
      });
    }

    // The king.
    const k = readKing(f, c);
    if (k.problem) {
      const files = k.openFiles.map(fileLetter);
      const fileText = files.length ? ` The ${files.join("- and ")}-file${files.length > 1 ? "s are" : " is"} open in front of it.` : "";
      const who = k.attackers.slice(0, 3).map((s) => pieceAt(f, s));
      const m: Partial<Marks> = {
        squares: [{ sq: me.king, tone: "danger", style: "pulse" }],
        arrows: k.attackers.slice(0, 4).map((from) => ({ from, to: me.king, tone: "danger" as const, thin: true })),
        bands: k.openFiles.map((index) => ({ kind: "file" as const, index, tone: "danger" as const })),
      };
      const title = { stuck: "A king stuck in the centre", uncastled: "The king hasn't castled", thin: "Thin cover in front of the king", attacked: "The king is under attack" }[k.problem];
      const text =
        k.problem === "stuck"
          ? `It can't castle any more, and the queens are still on.${fileText} The rooks can't connect either while the king stands between them.`
          : k.problem === "uncastled"
            ? `${N(o)} has castled and ${N(c)} hasn't.${fileText} Every move spent elsewhere is a move the king stays where lines open first.`
            : k.problem === "attacked"
              ? `${cap(num(k.attackers.length))} pieces bear on the squares around it (${list(who)}) and only ${num(k.defenders.length)} defend${k.defenders.length === 1 ? "s" : ""}.${fileText}`
              : `Only ${num(me.shelter.length)} pawn${me.shelter.length === 1 ? " is" : "s are"} left in front of it.${fileText}${who.length ? ` ${cap(list(who))} already point${who.length === 1 ? "s" : ""} that way.` : ""}`;
      add({ side: c, good: false, theme: "king", key: "king", title, text, marks: m, weight: k.weight });
      add({
        side: o,
        good: true,
        theme: "king",
        key: "their-king",
        title: k.problem === "stuck" || k.problem === "uncastled" ? `${N(c)}'s king is in the centre` : `Chances against ${N(c)}'s king`,
        text:
          k.problem === "stuck"
            ? `It can't castle. Open a centre file and the attack plays itself; a pawn is a fair price for that.`
            : k.problem === "uncastled"
              ? `${N(c)} still needs a move or two to castle. That is time to open the centre or win something while the king is tied to the middle.`
              : k.problem === "attacked"
                ? `${cap(num(k.attackers.length))} attackers against ${num(k.defenders.length)} defender${k.defenders.length === 1 ? "" : "s"}. With that count a sacrifice to tear the cover open often works: look at every check and capture near the king.`
                : `The pawn cover is thin${files.length ? ` and the ${files.join("- and ")}-file is open` : ""}. One more piece in the attack may be enough.`,
        marks: m,
        weight: k.weight - 6,
      });
    }

    // Endgames: the king as a piece.
    if (f.phase === "endgame") {
      const mine = toCentre(me.king);
      const theirs = toCentre(them.king);
      if (theirs - mine >= 2)
        add({
          side: c,
          good: true,
          theme: "king",
          key: "active-king",
          title: "The more active king",
          text: `${N(c)}'s king is ${num(theirs - mine)} squares nearer the centre. In an endgame that is like being a piece up where the kings can reach.`,
          marks: { squares: [{ sq: me.king, tone: "opportunity", style: "ring" }] },
          weight: 36 + 6 * (theirs - mine) + (me.pieces === 0 ? 14 : 0),
        });
    }

    // The best piece: a minor piece on an outpost, a rook on the seventh, an open file held alone.
    for (const sq of [...me.knights, ...me.bishops]) {
      if (!isOutpost(f.p, sq, c)) continue;
      const kind = PIECE_NAME[f.p[sq]!.type];
      const hits = f.ctx
        .attacks(sq)
        .filter((s) => f.p[s]?.color === o && f.p[s]!.type !== "p")
        .map((s) => pieceAt(f, s));
      const traders = attackersOf(f.p, sq, o).filter((s) => f.p[s]!.type === "n" || f.p[s]!.type === "b");
      const deep = rel(sq, c) >= 5;
      add({
        side: c,
        good: true,
        theme: "pieces",
        key: `outpost-${sq}`,
        title: `The ${kind} on ${sq}`,
        text: `A pawn protects it and no ${N(o)} pawn can ever attack it, so it stays as long as ${N(c)} likes.${hits.length ? ` From there it hits ${list(hits.slice(0, 3))}.` : deep ? ` That deep in ${N(o)}'s position it cuts the pieces off from each other.` : ""}${traders.length ? ` ${N(o)}'s way out is to trade it off with ${pieceAt(f, traders[0])}.` : ""}`,
        marks: { squares: [{ sq, tone: "opportunity", style: "ring" }], icons: [{ sq, icon: "star", tone: "opportunity" }] },
        weight: 46 + (deep ? 10 : 0) + (fileIndex(sq) >= 2 && fileIndex(sq) <= 5 ? 6 : 0) + 3 * hits.length - (traders.length ? 8 : 0),
      });
    }
    for (const sq of me.rooks) {
      if (rel(sq, c) !== 6) continue;
      const onRank = them.pawns.filter((x) => rankIndex(x.sq) === rankIndex(sq)).length;
      const kingBehind = rel(them.king, c) === 7;
      if (!onRank && !kingBehind) continue;
      add({
        side: c,
        good: true,
        theme: "lines",
        key: `seventh-${sq}`,
        title: `A rook on the seventh rank`,
        text: `From ${sq} it ${onRank ? `attacks ${num(onRank)} pawn${onRank === 1 ? "" : "s"} from the side` : "sweeps the rank"}${kingBehind ? ` and keeps the king on the back rank` : ""}. A second heavy piece joining it is usually decisive.`,
        marks: { bands: [{ kind: "rank", index: rankIndex(sq), tone: "opportunity" }], squares: [{ sq, tone: "opportunity", style: "ring" }] },
        weight: 44 + 5 * onRank + (kingBehind ? 6 : 0),
      });
    }
    for (const { file, pieces } of f.openFiles.length <= 2 ? ownedOpenFiles(f, c) : []) {
      const entry = relSquare(file, 6, c);
      add({
        side: c,
        good: true,
        theme: "lines",
        key: `file-${file}`,
        title: `The open ${fileLetter(file)}-file`,
        text: `${pieces.length > 1 ? `${N(c)}'s heavy pieces are doubled on it` : `${cap(pieceAt(f, pieces[0]))} holds it`} and ${N(o)} has nothing opposing. ${f.openFiles.length === 1 ? "It is the only open file, so" : "An open file is a road into the position:"} the entry square is ${entry}.`,
        marks: { bands: [{ kind: "file", index: file, tone: "opportunity" }], squares: entry ? [{ sq: entry, tone: "opportunity", style: "dashed" }] : [] },
        weight: 34 + (pieces.length > 1 ? 10 : 0) + (f.openFiles.length === 1 ? 6 : 0),
      });
    }

    // A half-open file with a heavy piece already on it and a pawn at the end of it.
    for (let file = 0; file < 8; file++) {
      const st = fileState(f.p, file);
      if (st[c] || !st[o]) continue;
      const heavy = [...me.rooks, ...me.queens].filter((s) => fileIndex(s) === file);
      if (!heavy.length) continue;
      const target = them.pawns.filter((x) => fileIndex(x.sq) === file).sort((a, b) => rel(a.sq, o) - rel(b.sq, o))[0];
      if (!target) continue;
      const pawnGuarded = attackersOf(f.p, target.sq, o).some((a) => f.p[a]!.type === "p");
      add({
        side: c,
        good: true,
        theme: "lines",
        key: `half-open-${file}`,
        title: `The half-open ${fileLetter(file)}-file`,
        text: `${N(c)} has no pawn on it and ${cap(pieceAt(f, heavy[0]))} already looks down it at ${pieceAt(f, target.sq)}${pawnGuarded ? ", which a pawn still protects: the pressure is there to be built on" : ", which only pieces can defend"}.`,
        marks: { bands: [{ kind: "file", index: file, tone: "opportunity" }], squares: [{ sq: target.sq, tone: "danger", style: "ring" }] },
        weight: 26 + (pawnGuarded ? 0 : 8) + (heavy.length > 1 ? 4 : 0),
      });
      break;
    }

    // A pin that costs something (lib/facts/threats.ts reports only those).
    const pin = facts.byLens.threats.find((x) => (x.kind === "pin-relative" || x.kind === "pin-absolute") && x.side === c && f.p[x.anchor]?.type !== "p");
    if (pin && !engine?.decided) {
      add({ side: c, good: false, theme: "tactics", key: `pin-${pin.anchor}`, title: `The pinned ${PIECE_NAME[f.p[pin.anchor]!.type]} on ${pin.anchor}`, text: pin.title.replace(/^(White|Black)'s /, "The "), marks: pin.marks, weight: 32, evidence: pin.evidence });
    }

    // The worst piece.
    let worstUsed = false;
    for (const sq of me.bishops) {
      const fixed = badBishop(f, sq);
      if (!fixed) continue;
      worstUsed = true;
      const colour = isLightSquare(sq) ? "light" : "dark";
      add({
        side: c,
        good: false,
        theme: "pieces",
        key: `bad-bishop-${sq}`,
        title: `The bishop on ${sq}`,
        text: `${N(c)}'s pawns on ${list(fixed)} stand on ${colour} squares and can't move, and this is the ${colour}-squared bishop. It guards them and sees little else. Trading it, or getting it outside the pawns, is a plan in itself.`,
        marks: { squares: [{ sq, tone: "danger", style: "pulse" }, ...fixed.map((s) => ({ sq: s, tone: "danger" as const, style: "ring" as const }))], icons: [{ sq, icon: "lock", tone: "danger" }] },
        weight: 40 + 3 * fixed.length,
      });
      const good = them.knights.length + them.bishops.length === 1 && me.knights.length + me.bishops.length === 1 && them.knights.length === 1;
      if (good)
        add({
          side: o,
          good: true,
          theme: "pieces",
          key: "good-knight",
          title: "Good knight against bad bishop",
          text: `${N(c)}'s only minor piece is shut in by its own pawns, and ${N(o)}'s knight can use the squares of the other colour that the bishop can never touch. That gap grows as pieces come off.`,
          marks: { squares: [{ sq: them.knights[0], tone: "opportunity", style: "ring" }, { sq, tone: "danger", style: "ring" }] },
          weight: 48,
        });
    }
    if (f.phase !== "endgame" && f.fullmove >= 8 && me.home.length >= 2) {
      add({
        side: c,
        good: false,
        theme: "time",
        key: "undeveloped",
        title: "Pieces still at home",
        text: `${cap(list(me.home.map((s) => pieceAt(f, s))))} ${me.home.length === 1 ? "hasn't" : "haven't"} moved yet. Until they do, the rooks can't see each other and ${N(c)} is playing with fewer pieces where it matters.`,
        marks: { squares: me.home.map((sq) => ({ sq, tone: "danger" as const, style: "ring" as const })) },
        weight: 24 + 7 * me.home.length + (openish ? 8 : 0),
      });
      worstUsed = true;
    }
    if (f.phase !== "endgame" && me.developed - them.developed >= 2) {
      const kingLate = !them.castled;
      add({
        side: c,
        good: true,
        theme: "time",
        key: "development",
        title: "A lead in development",
        text: `${N(c)} has ${num(me.developed - them.developed)} more pieces in play${kingLate ? `, and ${N(o)}'s king hasn't castled` : ""}. A lead like this is temporary: it has to be turned into something before ${N(o)} catches up, which means opening lines now.`,
        weight: 36 + 5 * (me.developed - them.developed) + (kingLate ? 8 : 0) + (openish ? 8 : 0),
      });
    }
    if (!worstUsed) {
      // A piece with nothing to do, for a reason that won't go away by itself: its own pawns are in its way, or it is a knight on the edge.
      const idle = me.activity
        .filter((x) => x.piece.type !== "q" && (x.piece.type !== "r" || endish) && !me.home.includes(x.sq))
        .map((x) => ({ ...x, pawnsInWay: ownBlockers(f.ctx, x.sq, "p"), rim: x.piece.type === "n" && (fileIndex(x.sq) === 0 || fileIndex(x.sq) === 7) }))
        .filter((x) => x.score < 0.4 && (x.rim || x.pawnsInWay.length >= 2))
        .sort((a, b) => a.score - b.score)[0];
      if (idle) {
        const blockers = idle.pawnsInWay.map((s) => pieceAt(f, s));
        add({
          side: c,
          good: false,
          theme: "pieces",
          key: `idle-${idle.sq}`,
          title: `The ${PIECE_NAME[idle.piece.type]} on ${idle.sq}`,
          text: idle.rim
            ? `On the edge it reaches ${num(Math.min(8, idle.safe.length))} safe square${idle.safe.length === 1 ? "" : "s"} and attacks nothing. It needs a route back toward the centre.`
            : `It has ${idle.safe.length ? `only ${num(Math.min(8, idle.safe.length))} safe square${idle.safe.length === 1 ? "" : "s"}` : "no safe squares"} and attacks nothing: ${list(blockers.slice(0, 3))} are in its way. ${N(c)}'s position improves most by finding this piece a job.`,
          marks: { squares: [{ sq: idle.sq, tone: "danger", style: "pulse" }, ...idle.pawnsInWay.map((s) => ({ sq: s, tone: "info" as const, style: "ring" as const }))], icons: [{ sq: idle.sq, icon: "lock", tone: "danger" }] },
          weight: 30 + (idle.rim ? 0 : 4),
        });
      }
    }

    // Pawns: targets first, then assets.
    const iqp = structures.find((s) => s.id === "iqp" && s.side === c);
    const targets = weakPawns(f, c)
      .sort((a, b) => Number(b.vulnerable) - Number(a.vulnerable) || Math.abs(3.5 - fileIndex(a.sq)) - Math.abs(3.5 - fileIndex(b.sq)))
      .slice(0, 2);
    for (const x of targets) {
      const file = fileIndex(x.sq);
      const front = relSquare(file, rel(x.sq, c) + 1, c);
      const isIqp = !!iqp && file === 3;
      add({
        side: c,
        good: false,
        theme: "pawns",
        key: `weak-${x.sq}`,
        title: `The ${x.isolated ? "isolated" : "backward"} ${fileLetter(file)}-pawn`,
        text: isIqp && !endish
          ? `No pawn can defend it, and ${front} in front of it is a square for ${N(o)}'s pieces. For now it gives ${N(c)} space and open lines in return; the more pieces come off, the more it is simply weak.`
          : x.isolated
            ? `No pawn can defend it and it stands on a half-open file, so ${N(o)}'s rooks can line up against it. Every piece that guards it is a piece that can't do anything else.`
            : `It can't advance safely and no pawn can get beside it to help. On a half-open file that makes it a fixed target, and ${front} in front of it is a square for ${N(o)}'s pieces.`,
        marks: { squares: [{ sq: x.sq, tone: "danger", style: "ring" }, ...(front ? [{ sq: front, tone: "danger" as const, style: "pit" as const }] : [])], bands: [{ kind: "file", index: file, tone: "danger" }] },
        weight: (isIqp && !endish ? 26 : 36) + (x.vulnerable ? 8 : 0) + (endish ? 8 : 0),
      });
    }
    const doubled = me.pawns.filter((x) => x.doubled);
    if (doubled.length) {
      const file = fileIndex(doubled[0].sq);
      const isolated = doubled.some((x) => x.isolated);
      add({
        side: c,
        good: false,
        theme: "pawns",
        key: `doubled-${file}`,
        title: `Doubled ${fileLetter(file)}-pawns`,
        text: `Two pawns on one file can't protect each other and the front one blocks the one behind${isolated ? `; with no pawn beside them, pieces have to do the guarding` : ""}. They still cover squares, so the damage shows mainly in an endgame.`,
        marks: { squares: doubled.filter((x) => fileIndex(x.sq) === file).map((x) => ({ sq: x.sq, tone: "danger" as const, style: "ring" as const })) },
        weight: 18 + (isolated ? 12 : 0) + (endish ? 8 : 0),
      });
    }
    if (me.islands - them.islands >= 2 || (endish && me.islands >= 3 && me.islands > them.islands))
      add({
        side: c,
        good: false,
        theme: "pawns",
        key: "islands",
        title: "Scattered pawns",
        text: `${N(c)}'s pawns stand in ${num(me.islands)} separate groups against ${N(o)}'s ${num(them.islands)}. Each group has a pawn at its base that only pieces can defend, so more groups means more to look after.`,
        weight: 22 + (endish ? 10 : 0),
      });

    const passers = me.pawns.filter((x) => x.passed).sort((a, b) => rel(b.sq, c) - rel(a.sq, c));
    if (passers.length) {
      const x = passers[0];
      const file = fileIndex(x.sq);
      const togo = 7 - rel(x.sq, c);
      const connected = passers.some((y) => y !== x && Math.abs(fileIndex(y.sq) - file) === 1);
      const outside = (file <= 1 || file >= 6) && Math.abs(fileIndex(them.king) - file) >= 3;
      const run: Square[] = [];
      for (let r = rel(x.sq, c) + 1; r <= 7; r++) {
        const s = relSquare(file, r, c);
        if (s) run.push(s);
      }
      add({
        side: c,
        good: true,
        theme: "pawns",
        key: `passed-${x.sq}`,
        title: connected ? "Connected passed pawns" : x.protectedPassed ? `A protected passed pawn on ${x.sq}` : outside ? `An outside passed pawn on ${x.sq}` : `A passed pawn on ${x.sq}`,
        text: `${connected ? `No ${N(o)} pawn can stop them, so pieces have to.` : `No ${N(o)} pawn can stop it, so a piece has to.`} ${
          connected
            ? "Side by side they protect each other as they advance, and stopping them usually costs a piece."
            : x.protectedPassed
              ? "A pawn guards it, so it can't be won by a king alone and it ties a piece down for the rest of the game."
              : outside
                ? `It is far from the kings: whatever goes to stop it leaves the other wing to ${N(c)}.`
                : `It is ${num(togo)} square${togo === 1 ? "" : "s"} from queening.`
        }${x.blockader ? ` For now ${pieceAt(f, x.blockader)} blocks it.` : ""}`,
        marks: { squares: [{ sq: x.sq, tone: "opportunity", style: "ring" }, ...run.map((sq, i) => ({ sq, tone: "opportunity" as const, style: "flood" as const, order: i }))] },
        weight: 26 + 7 * Math.max(0, rel(x.sq, c) - 3) + (endish ? 14 : 0) + (x.protectedPassed ? 8 : 0) + (connected ? 12 : 0) + (outside ? 6 : 0) - (x.blockader ? 6 : 0),
      });
    } else if (endish) {
      const wing = (["queenside", "kingside"] as Wing[]).find((w) => me.wingPawns[w] > them.wingPawns[w] && me.wingPawns[w] >= 2);
      if (wing) {
        const far = wingOfFile(fileIndex(them.king)) !== wing;
        add({
          side: c,
          good: true,
          theme: "pawns",
          key: `majority-${wing}`,
          title: `A ${wing} majority`,
          text: `${cap(num(me.wingPawns[wing]))} pawns against ${num(them.wingPawns[wing])} on the ${wing}. Advanced in the right order they make a passed pawn${far ? `, and ${N(o)}'s king is on the other side of the board` : ""}.`,
          marks: { squares: me.pawns.filter((x) => wingOfFile(fileIndex(x.sq)) === wing).map((x) => ({ sq: x.sq, tone: "opportunity" as const, style: "ring" as const })) },
          weight: 30 + (far ? 8 : 0),
        });
      }
    }

    // A hole in the other camp that a knight can reach.
    if (f.phase !== "endgame") {
      const usable = them.holes
        .filter((sq) => fileIndex(sq) >= 2 && fileIndex(sq) <= 5 && !f.p[sq] && !drafts.some((d) => d.key === `outpost-${sq}`))
        .map((sq) => ({ sq, knight: me.knights.find((n) => knightDistance(n, sq) <= 2), pawnGuard: attackersOf(f.p, sq, c).some((a) => f.p[a]!.type === "p") }))
        .filter((x) => x.knight && (x.pawnGuard || (rel(x.sq, o) === 3 && attackersOf(f.p, x.sq, c).length >= attackersOf(f.p, x.sq, o).length)))
        .sort((a, b) => Number(b.pawnGuard) - Number(a.pawnGuard))[0];
      if (usable)
        add({
          side: c,
          good: true,
          theme: "pawns",
          key: `hole-${usable.sq}`,
          title: `The hole on ${usable.sq}`,
          text: `No ${N(o)} pawn can ever cover ${usable.sq} again. ${cap(pieceAt(f, usable.knight!))} can get there, and once it does nothing but a trade removes it.`,
          marks: { squares: [{ sq: usable.sq, tone: "opportunity", style: "pit" }], arrows: [{ from: usable.knight!, to: usable.sq, tone: "idea", dashed: true }] },
          weight: 30 + (usable.pawnGuard ? 8 : 0),
        });
    }

    // Space.
    if (f.phase !== "endgame" && me.space - them.space >= 5 && me.pieces >= 20 && them.pieces >= 20) {
      add({
        side: c,
        good: true,
        theme: "space",
        key: "space",
        title: "More space",
        text: `${N(c)}'s pawns stand further up the board, so the pieces behind them have more room and can switch wings faster than ${N(o)}'s. Space is felt most with many pieces on: avoid trades.`,
        weight: 26 + Math.min(14, me.space - them.space),
      });
      add({
        side: o,
        good: false,
        theme: "space",
        key: "cramped",
        title: "Short of room",
        text: `There are more ${N(o)} pieces than good squares for them. A pawn break or a trade of minor pieces is how a cramped side breathes.`,
        weight: 22 + Math.min(14, me.space - them.space),
      });
    }

    // Loose pieces: what can be taken right now.
    for (const x of facts.byLens.threats.filter((t) => (t.kind === "hanging" || t.kind === "attacked-by-cheaper") && t.side === c)) {
      const theirMove = f.turn === o;
      if (!theirMove && f.p[x.anchor]?.type === "p") continue;
      // What looks free often isn't: once the engine has spoken, only what it actually takes counts,
      // and a piece of the side to move only if the engine's move is about saving it.
      if (engine?.decided) continue;
      if (theirMove && checked && x.evidence !== "engine") continue;
      if (!theirMove && checked && engine?.first && engine.first.from !== x.anchor) continue;
      add({
        side: c,
        good: false,
        theme: "tactics",
        key: `loose-${x.anchor}`,
        title: `${cap(pieceAt(f, x.anchor))} is ${x.kind === "hanging" ? "undefended" : "attacked by a cheaper piece"}`,
        text: theirMove
          ? checked
            ? `It is ${N(o)}'s move and the engine's first choice is to take it. Plans come after this.`
            : `It is ${N(o)}'s move, so it can be taken unless something else is going on. Plans come after this.`
          : `${N(c)} is to move and has to deal with it first: move it, defend it, or find a bigger threat.`,
        marks: x.marks,
        weight: theirMove ? 88 : 58,
        evidence: x.evidence,
      });
    }
  }

  const out: Record<Color, { likes: Point[]; dislikes: Point[] }> = { w: { likes: [], dislikes: [] }, b: { likes: [], dislikes: [] } };
  for (const d of drafts.sort((a, b) => b.weight - a.weight)) {
    const bucket = out[d.side][d.good ? "likes" : "dislikes"];
    if (bucket.length >= 4 || bucket.some((x) => x.id === `${d.side}-${d.key}`)) continue;
    // One point per theme unless the second one is weighty too: four pawn remarks in a row say less than one.
    if (bucket.filter((x) => x.theme === d.theme).length >= 2) continue;
    bucket.push({ id: `${d.side}-${d.key}`, side: d.side, good: d.good, theme: d.theme, title: d.title, text: d.text, marks: marks(d.marks ?? {}), weight: d.weight, evidence: d.evidence ?? "rules" });
  }
  return out;
}

/** Knight moves from `a` to `b` on an empty board (capped at 4). */
export function knightDistance(a: Square, b: Square): number {
  if (a === b) return 0;
  let frontier = [a];
  const seen = new Set<Square>(frontier);
  for (let d = 1; d <= 3; d++) {
    const next: Square[] = [];
    for (const s of frontier)
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
        const t = toSquare(fileIndex(s) + df, rankIndex(s) + dr);
        if (!t || seen.has(t)) continue;
        if (t === b) return d;
        seen.add(t);
        next.push(t);
      }
    frontier = next;
  }
  return 4;
}
