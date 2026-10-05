/**
 * What a move does on the board, in a coach's terms: tactics (forks, pins, skewers,
 * discovered attacks, removing a defender), lines (open and half-open files, long
 * diagonals, batteries, the seventh rank), the king (attack, safety, luft, castling),
 * pieces (outposts, centralisation, the worst piece coming back to life, restricting
 * or trapping enemy pieces), pawns (breaks, passed pawns, structure, space) and
 * development. Mobility counts are only a last resort.
 *
 * Every idea is checked against the position; the engine line after the move is used
 * to weight ideas the engine actually plays on (a file it uses, a piece it trades).
 */
import { Chess } from "chess.js";
import { ALL_SQUARES, attackersOf, attacksFrom, between, fileIndex, kingSquare, rankIndex } from "../chess/board";
import { placementFromFen } from "../chess/fen";
import { COLOR_NAME, PIECE_NAME, PIECE_VALUE, other, type Color, type Placement, type Square } from "../chess/types";
import { isOutpost, safeMobility } from "../facts/activity";
import { findPins } from "../facts/context";
import { classifyPawns } from "../facts/pawns";
import { emptyMarks, type Marks, type Tone } from "../facts/types";
import { buildVariation, type VariationMove } from "../variation";
import { CENTRE, aims, dirsOf, filePawns, kingZone, loose, ray, relRank, zonePressure } from "./geometry";
import type { Idea, IdeaKind } from "./types";

export interface IdeaContext {
  /** The engine line after the move, opponent first (verified moves). */
  after: VariationMove[];
  /** Mover-relative evaluation after the move, in centipawns (mates as ±10000). */
  evalAfter: number;
  /** True when the move is (close to) the engine's choice, so its line is a plan worth describing. */
  goodMove?: boolean;
}

const val = (t: string) => (t === "k" ? 100 : PIECE_VALUE[t as keyof typeof PIECE_VALUE]);
const FILE = (sq: Square) => sq[0];

/** "the h3 pawn" / "the knight on f6" / "the king". */
export function nm(p: Placement, sq: Square): string {
  const x = p[sq];
  if (!x) return sq;
  if (x.type === "p") return `the ${sq} pawn`;
  if (x.type === "k") return "the king";
  return `the ${PIECE_NAME[x.type]} on ${sq}`;
}

/**
 * What each side captures along a line, up to a settled point (not mid-exchange).
 * Used to say "wins the queen for a bishop" instead of a points total.
 */
export function netCaptures(fen: string, pv: string[], mover: Color, maxPlies = 10, minPlies = 4): { mine: string[]; theirs: string[]; swing: number } {
  const v = buildVariation(fen, pv, maxPlies);
  // Count up to a settled point: two quiet plies after the last capture, and at least `minPlies` in.
  let end = v.moves.length;
  let quiet = 0;
  for (let i = 0; i < v.moves.length; i++) {
    quiet = v.moves[i].captured ? 0 : quiet + 1;
    if (quiet >= 2 && i + 1 >= minPlies) {
      end = i + 1;
      break;
    }
  }
  const mine: string[] = [];
  const theirs: string[] = [];
  for (const m of v.moves.slice(0, end)) if (m.captured) (m.color === mover ? mine : theirs).push(m.captured);
  const sum = (a: string[]) => a.reduce((s, t) => s + PIECE_VALUE[t as keyof typeof PIECE_VALUE], 0);
  return { mine, theirs, swing: sum(mine) - sum(theirs) };
}

/**
 * Lasting damage to `who` at the settled end of a line: doubled or isolated pawns,
 * a king shelter with pawns missing, the bishop pair gone.
 */
export function consequences(fen: string, pv: string[], who: Color, maxPlies = 10): string[] {
  const v = buildVariation(fen, pv, maxPlies);
  let end = v.moves.length;
  let quiet = 0;
  for (let i = 0; i < v.moves.length; i++) {
    quiet = v.moves[i].captured ? 0 : quiet + 1;
    if (quiet >= 2 && i + 1 >= 4) {
      end = i + 1;
      break;
    }
  }
  if (!end) return [];
  const a = placementFromFen(fen);
  const b = placementFromFen(v.moves[end - 1].fenAfter);
  const out: string[] = [];
  const pa = classifyPawns(a).filter((x) => x.color === who);
  const pb = classifyPawns(b).filter((x) => x.color === who);
  const doubled = pb.find((x) => x.doubled && !pa.some((y) => y.doubled && fileIndex(y.sq) === fileIndex(x.sq)));
  if (doubled) out.push(`doubled ${FILE(doubled.sq)}-pawns`);
  const isolated = pb.find((x) => x.isolated && !pa.some((y) => y.isolated && y.sq === x.sq) && !doubled);
  if (isolated) out.push(`an isolated pawn on ${isolated.sq}`);
  const k = kingSquare(b, who);
  if (k && relRank(k, who) <= 1 && (fileIndex(k) <= 2 || fileIndex(k) >= 5)) {
    const cover = (p: Placement) => [-1, 0, 1].filter((d) => {
      const f = fileIndex(k) + d;
      return f >= 0 && f < 8 && ALL_SQUARES.some((s) => fileIndex(s) === f && p[s]?.type === "p" && p[s]!.color === who && relRank(s, who) >= 1 && relRank(s, who) <= 2);
    }).length;
    if (cover(b) < cover(a)) out.push("a king with pawns missing from its shelter");
  }
  const bishops = (p: Placement) => ALL_SQUARES.filter((s) => p[s]?.color === who && p[s]!.type === "b").length;
  if (bishops(a) === 2 && bishops(b) < 2) out.push("no bishop pair");
  return out;
}

const ARTICLE: Record<string, string> = { p: "a pawn", n: "a knight", b: "a bishop", r: "a rook", q: "the queen" };

/** "the queen for a bishop", "a knight", "two pawns", "the exchange" (rook for minor). */
export function gainWords(c: { mine: string[]; theirs: string[]; swing: number }): string {
  const byValue = (a: string[]) => [...a].sort((x, y) => PIECE_VALUE[y as keyof typeof PIECE_VALUE] - PIECE_VALUE[x as keyof typeof PIECE_VALUE]);
  const mine = byValue(c.mine);
  const theirs = byValue(c.theirs);
  // Cancel equal trades (a knight for a bishop is a trade too).
  for (const t of [...theirs]) {
    const k = mine.findIndex((x) => PIECE_VALUE[x as keyof typeof PIECE_VALUE] === PIECE_VALUE[t as keyof typeof PIECE_VALUE]);
    if (k >= 0) {
      mine.splice(k, 1);
      theirs.splice(theirs.indexOf(t), 1);
    }
  }
  if (!mine.length) return materialWords(c.swing);
  if (mine.length === 2 && mine.every((x) => x === "p") && !theirs.length) return "two pawns";
  const top = mine[0];
  if (top === "r" && theirs.length === 1 && (theirs[0] === "n" || theirs[0] === "b")) return "the exchange";
  const main = ARTICLE[top] ?? materialWords(c.swing);
  if (!theirs.length) return mine.length > 1 ? `${main} and ${ARTICLE[mine[1]].replace("the ", "a ")}` : main;
  const back = theirs.length === 1 ? ARTICLE[theirs[0]].replace("the ", "a ") : materialWords(theirs.reduce((s, t) => s + PIECE_VALUE[t as keyof typeof PIECE_VALUE], 0));
  return `${main} for ${back}`;
}

export function materialWords(n: number): string {
  const a = Math.abs(n);
  if (a === 1) return "a pawn";
  if (a === 2) return "two pawns";
  if (a === 3) return "a piece";
  if (a === 4) return "a piece and a pawn";
  if (a === 5) return "the exchange plus a pawn";
  if (a === 9) return "a queen's worth";
  return `${a} points of material`;
}

function idea(kind: IdeaKind, phrase: string, text: string, weight: number, marks: Partial<Marks> = {}, tone: Tone = "opportunity", evidence: Idea["evidence"] = "rules"): Idea {
  return { kind, phrase, text, tone, evidence, weight, marks: { ...emptyMarks(), ...marks } };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Can the opponent simply take the piece on `sq` without losing material: with an
 * equal or cheaper piece, or with anything if it's undefended? (Then its threats don't count.)
 */
export function capturable(p: Placement, sq: Square): boolean {
  const x = p[sq];
  if (!x || x.type === "k") return false;
  const enemy = other(x.color);
  const defended = attackersOf(p, sq, x.color).length > 0;
  return attackersOf(p, sq, enemy).some((a) => {
    const t = p[a]!.type;
    if (t === "k") return !defended;
    return !defended || val(t) <= val(x.type);
  });
}

/** Squares a piece could safely use (no own piece there, no enemy pawn guarding it). */
function mobility(p: Placement, sq: Square) {
  return safeMobility(p, sq, attacksFrom(p, sq)).length;
}

const TYPICAL: Record<string, number> = { n: 5, b: 7, r: 8, q: 14 };

/** The mover's least active minor or major piece (mobility relative to what's normal for its type). */
function worstPiece(p: Placement, c: Color): Square | null {
  let worst: Square | null = null;
  let score = Infinity;
  for (const s of ALL_SQUARES) {
    const x = p[s];
    if (!x || x.color !== c || !(x.type in TYPICAL)) continue;
    const sc = mobility(p, s) / TYPICAL[x.type];
    if (sc < score) {
      score = sc;
      worst = s;
    }
  }
  return score < 0.45 ? worst : null;
}

/** Does the engine line have the mover use this square/line later? */
function lineUses(ctx: IdeaContext, me: Color, test: (m: VariationMove) => boolean): boolean {
  return ctx.after.slice(0, 8).some((m) => m.color === me && test(m));
}

export function boardIdeas(m: VariationMove, ctx: IdeaContext): Idea[] {
  const ideas: Idea[] = [];
  const before = placementFromFen(m.fenBefore);
  const after = placementFromFen(m.fenAfter);
  const me = m.color;
  const them = other(me);
  const piece = m.piece;
  const name = PIECE_NAME[piece];
  const myK = kingSquare(after, me);
  const theirK = kingSquare(after, them);
  const pv = [m.uci, ...ctx.after.map((x) => x.uci)];

  if (m.san.includes("#")) return [idea("mate", "delivers checkmate", "Checkmate.", 100, { squares: [{ sq: m.to, tone: "opportunity", style: "fill" }] })];
  if (m.promotion) ideas.push(idea("promotion", `promotes to a ${PIECE_NAME[m.promotion]}`, `Promotes the pawn to a ${PIECE_NAME[m.promotion]}.`, 60, { squares: [{ sq: m.to, tone: "opportunity", style: "fill" }] }));

  // ---- Material and trades -------------------------------------------------
  const net = netCaptures(m.fenBefore, pv, me, 10);
  const swing = net.swing;
  const reply = ctx.after[0];
  const recaptured = !!(m.captured && reply?.captured && reply.to === m.to);
  const firstGrab = ctx.after.find((x) => x.color === me && x.captured);
  if (swing >= 1 && (m.captured || ctx.after.slice(0, 5).some((x) => x.captured)) && ctx.goodMove === false) {
    // The line wins material for a while, but the engine says the move is a mistake: it comes back.
    if (m.captured) ideas.push(idea("material", `grabs ${nm(before, m.to)}`, `Grabs ${nm(before, m.to)}, but the engine expects ${COLOR_NAME[me]} to give the material back.`, 9));
  } else if (swing >= 1 && (m.captured || ctx.after.slice(0, 5).some((x) => x.captured))) {
    const via = !m.captured && firstGrab ? `, picking it up with ${firstGrab.color === "w" ? `${firstGrab.moveNumber}.` : `${firstGrab.moveNumber}…`}${firstGrab.san}` : "";
    const how = m.captured ? `takes ${nm(before, m.to)}` : "sets up a sequence";
    ideas.push(
      idea("material", `wins ${gainWords(net)}${via}`, `${cap(how)} and wins ${gainWords(net)} once the captures settle${via}.`, 55 + 8 * Math.min(swing, 9), {
        squares: [{ sq: m.to, tone: "opportunity", style: "ring" }],
      }, "opportunity", "engine"),
    );
  } else if (m.captured && recaptured && swing >= -0.5) {
    const mine = m.promotion ?? piece;
    const theirs = m.captured;
    const what = mine === theirs ? `trades ${PIECE_NAME[mine]}s` : `trades ${PIECE_NAME[mine]} for ${PIECE_NAME[theirs]}`;
    let why = "";
    let w = 14;
    if (theirs === "q" && mine === "q") {
      const pressure = myK ? zonePressure(before, myK, them) : 0;
      if (ctx.evalAfter >= 150) {
        why = ": the queens come off while ahead, which makes the extra material easier to convert";
        w += 14;
      } else if (pressure >= 4) {
        why = ": with the queens gone, the attack on the king loses its punch";
        w += 14;
      }
    } else if (ctx.evalAfter >= 200) {
      why = ": trading pieces when ahead brings the win closer";
      w += 8;
    }
    // Removing a defender: something of theirs that leaned on the captured piece is now loose.
    const exposed = ALL_SQUARES.filter((s) => after[s]?.color === them && s !== m.to && !loose(before, s) && loose(placementFromFen(reply.fenAfter), s) && attackersOf(before, s, them).includes(m.to));
    if (exposed.length) {
      ideas.push(
        idea("defender", `removes the defender of ${nm(after, exposed[0])}`, `Removes the piece that was guarding ${nm(after, exposed[0])}.`, 26, {
          squares: [{ sq: exposed[0], tone: "danger", style: "ring" }],
        }),
      );
    }
    ideas.push(idea("trade", what, `${cap(what)}${why}.`, w, { squares: [{ sq: m.to, tone: "info", style: "ring" }] }, "info"));
  } else if (m.captured) {
    ideas.push(idea("material", `takes ${nm(before, m.to)}`, `Takes ${nm(before, m.to)}.`, swing >= 0 ? 16 : 6, { squares: [{ sq: m.to, tone: "opportunity", style: "ring" }] }));
  }

  // ---- Tactics around the moved piece ------------------------------------------
  const targets = (from: Square, p: Placement) =>
    attacksFrom(p, from).filter((s) => {
      const x = p[s];
      if (!x || x.color !== them) return false;
      if (x.type === "k") return true;
      return val(x.type) > val(p[from]!.type) || !attackersOf(p, s, them).length;
    });
  // A fork or attack by a piece that can simply be taken isn't a real threat.
  const moverLoose = capturable(after, m.to);
  const hitNow = moverLoose ? [] : targets(m.to, after);
  const hitBefore = new Set(before[m.from] ? targets(m.from, before) : []);
  const fresh = hitNow.filter((s) => !hitBefore.has(s) || m.isCheck);
  const valuable = fresh.filter((s) => after[s]!.type !== "p" || !attackersOf(after, s, them).length);
  if (valuable.length >= 2 && valuable.some((s) => after[s]!.type !== "p")) {
    const sorted = valuable.sort((a, b) => val(after[b]!.type) - val(after[a]!.type));
    const names = sorted.slice(0, 2).map((s) => (after[s]!.type === "k" ? "the king" : `the ${PIECE_NAME[after[s]!.type]}`));
    ideas.push(
      idea("fork", `forks ${names.join(" and ")}`, `The ${name} forks ${names.join(" and ")}: both can't be saved at once.`, 40, {
        arrows: sorted.slice(0, 3).map((s) => ({ from: m.to, to: s, tone: "opportunity" as const })),
        squares: sorted.slice(0, 3).map((s) => ({ sq: s, tone: "danger" as const, style: "ring" as const })),
      }),
    );
  } else {
    for (const s of fresh.filter((x) => after[x]!.type !== "k").slice(0, 1)) {
      const t = after[s]!;
      const undefended = !attackersOf(after, s, them).length;
      const phrase = t.type === "q" ? "attacks the queen" : undefended ? `attacks ${nm(after, s)}, which is undefended` : `attacks ${nm(after, s)}`;
      ideas.push(idea("attack", phrase, `${cap(phrase)}.`, t.type === "q" ? 16 : undefended ? 14 : 11, { arrows: [{ from: m.to, to: s, tone: "opportunity" }], squares: [{ sq: s, tone: "danger", style: "ring" }] }));
    }
  }

  // Skewers: a valuable piece in front, another behind it on the same line.
  if (["b", "r", "q"].includes(piece) && !moverLoose) {
    for (const d of dirsOf(piece)) {
      const line = ray(after, m.to, d[0], d[1]).filter((s) => after[s]);
      const [front, back] = line;
      if (!front || !back) continue;
      const F = after[front]!;
      const B = after[back]!;
      if (F.color !== them || B.color !== them) continue;
      if ((F.type === "k" || val(F.type) > val(B.type)) && val(B.type) >= 3 && val(F.type) > val(piece === "q" ? "r" : piece)) {
        ideas.push(
          idea("skewer", `skewers ${F.type === "k" ? "the king" : `the ${PIECE_NAME[F.type]}`} and ${nm(after, back)}`, `Skewers ${F.type === "k" ? "the king" : `the ${PIECE_NAME[F.type]}`}: when it moves, ${nm(after, back)} behind it falls.`, 34, {
            arrows: [{ from: m.to, to: back, tone: "opportunity" }],
          }),
        );
        break;
      }
    }
  }

  // Pins created by this move (by the moved piece or a line it opened).
  const pinsBefore = new Set(findPins(before).map((x) => `${x.pinned}${x.pinner}`));
  for (const pin of findPins(after)) {
    if (after[pin.pinner]?.color !== me || pinsBefore.has(`${pin.pinned}${pin.pinner}`) || loose(after, pin.pinner)) continue;
    if (after[pin.pinned]!.type === "p") continue;
    const behind = pin.absolute ? "the king" : `the ${PIECE_NAME[after[pin.behind]!.type]}`;
    const pawnPin = after[pin.pinned]!.type === "p";
    ideas.push(
      idea("pin", `pins ${nm(after, pin.pinned)} to ${behind}`, `Pins ${nm(after, pin.pinned)} to ${behind}${pin.absolute ? ": it can't move at all" : ""}.`, pawnPin ? 6 : pin.absolute ? 24 : 18, {
        arrows: [{ from: pin.pinner, to: pin.behind, tone: "opportunity", dashed: true }],
        squares: [{ sq: pin.pinned, tone: "danger", style: "ring" }],
      }),
    );
    break;
  }

  // Discovered attacks: own sliders that now see an enemy piece through the vacated square.
  if (!m.isCastle) {
    for (const sq of ALL_SQUARES) {
      const x = after[sq];
      if (!x || x.color !== me || sq === m.to || !["b", "r", "q"].includes(x.type)) continue;
      if (!between(sq, m.from).length && attacksFrom(before, sq).indexOf(m.from) < 0) continue;
      const gained = attacksFrom(after, sq)
        .filter((t) => after[t]?.color === them && !attacksFrom(before, sq).includes(t))
        .sort((a, b) => val(after[b]!.type) - val(after[a]!.type));
      if (!gained.length) continue;
      const t = gained[0];
      const check = after[t]!.type === "k";
      const real = check || val(after[t]!.type) >= val(x.type) || !attackersOf(after, t, them).length;
      ideas.push(
        idea("attack", check ? "gives a discovered check" : real ? `uncovers an attack on ${nm(after, t)}` : `opens the line of ${nm(after, sq)} to ${nm(after, t)}`, check ? `Moving away uncovers check from ${nm(after, sq)}.` : `Moving away uncovers ${nm(after, sq)}, which now hits ${nm(after, t)}.`, check ? 28 : real ? 18 : 8, {
          arrows: [{ from: sq, to: t, tone: "opportunity" }],
          squares: [{ sq: m.from, tone: "opportunity", style: "dashed" }],
        }),
      );
      break;
    }
  }

  // ---- Lines: files, ranks, diagonals ------------------------------------------
  if ((piece === "r" || piece === "q") && FILE(m.from) !== FILE(m.to) && !m.captured) {
    const f = fileIndex(m.to);
    const pawns = filePawns(after, f);
    const forward = me === "w" ? 1 : -1;
    const ahead = ray(after, m.to, 0, forward).filter((s) => after[s]);
    const first = ahead[0];
    const target = first && after[first]!.color === them ? first : ahead[1] && after[ahead[1]]!.color === them && after[first!]!.color === me ? ahead[1] : null;
    const kind = !pawns.w && !pawns.b ? "open" : !pawns[me] ? "half-open" : null;
    if (kind && piece === "r") {
      const uses = lineUses(ctx, me, (x) => fileIndex(x.from) === f || fileIndex(x.to) === f);
      const aimText = target ? `, aiming at ${nm(after, target)}${first !== target ? ` behind ${nm(after, first!)}` : ""}` : "";
      ideas.push(
        idea("line", `takes the ${kind} ${FILE(m.to)}-file${aimText}`, `The rook takes the ${kind} ${FILE(m.to)}-file${aimText}.`, (kind === "open" ? 15 : 12) + (target ? 5 : 0) + (uses ? 8 : 0), {
          arrows: target ? [{ from: m.to, to: target, tone: "opportunity" }] : [],
          bands: [{ kind: "file", index: f, tone: "opportunity" }],
        }),
      );
    }
  }
  if (piece === "r" && relRank(m.to, me) === 6 && relRank(m.from, me) !== 6) {
    const victims = ALL_SQUARES.filter((s) => rankIndex(s) === rankIndex(m.to) && after[s]?.color === them && after[s]!.type === "p").length;
    const kingBack = theirK && relRank(theirK, me) === 7;
    if (victims || kingBack) {
      ideas.push(
        idea("seventh", "invades the seventh rank", `The rook reaches the seventh rank${victims ? `, where ${victims} pawn${victims > 1 ? "s sit" : " sits"}` : ""}${kingBack ? " and the king is cut off on the back rank" : ""}.`, 18, {
          bands: [{ kind: "rank", index: rankIndex(m.to), tone: "opportunity" }],
        }),
      );
    }
  }
  if ((piece === "b" || piece === "q") && theirK && !m.isCheck && !moverLoose) {
    // Aiming at the king itself (through one piece), or at a weak pawn in front of a castled king.
    const zone = new Set(kingZone(theirK));
    const castled = fileIndex(theirK) <= 2 || fileIndex(theirK) >= 5;
    for (const a of aims(after, m.to)) {
      if (Math.abs(a.dir[0]) !== 1 || Math.abs(a.dir[1]) !== 1) continue;
      const tgtPiece = after[a.target]!;
      const atKing = tgtPiece.type === "k";
      const weakCover = zone.has(a.target) && castled && tgtPiece.type === "p" && (loose(after, a.target) || attackersOf(after, a.target, them).length <= 1);
      if (!atKing && !weakCover) continue;
      if (aims(before, m.from).some((b) => b.target === a.target)) continue;
      const tgt = atKing ? "the king" : nm(after, a.target);
      ideas.push(
        idea(
          "king-attack",
          atKing ? `eyes the king${a.through ? ` through ${nm(after, a.through)}` : ""}` : `aims at ${tgt}, a weak point next to the king`,
          atKing ? `The ${name} lines up with the ${COLOR_NAME[them]} king${a.through ? `, behind ${nm(after, a.through)}` : ""}.` : `The ${name} aims at ${tgt}, a weak point in front of the ${COLOR_NAME[them]} king.`,
          atKing ? (a.through ? 12 : 10) : 9,
          { arrows: [{ from: m.to, to: a.target, tone: "opportunity", dashed: !!a.through }] },
        ),
      );
      break;
    }
  }
  // Batteries: two heavy pieces doubled on a file, or queen and bishop on a diagonal.
  if (["q", "r", "b"].includes(piece)) {
    for (const d of dirsOf(piece)) {
      const next = ray(after, m.to, d[0], d[1]).find((s) => after[s]);
      if (!next) continue;
      const y = after[next]!;
      if (y.color !== me) continue;
      const straight = d[0] === 0 || d[1] === 0;
      const ok = straight ? ["r", "q"].includes(y.type) && piece !== "b" : ["b", "q"].includes(y.type) && piece !== "r";
      if (!ok || (piece !== "q" && y.type !== "q" && piece === y.type && !straight)) continue;
      const wasBattery = ray(before, m.from, d[0], d[1]).find((s) => before[s]) === next;
      if (wasBattery) continue;
      // The battery must point somewhere: the other way along the line from the moved piece.
      const front = ray(after, m.to, -d[0], -d[1]).find((s) => after[s]);
      const fileOpenish = straight && d[0] === 0 && !filePawns(after, fileIndex(m.to))[me];
      if (!(front && after[front]!.color === them) && !fileOpenish) continue;
      const lineName = straight ? (d[0] === 0 ? `the ${FILE(m.to)}-file` : `the ${m.to[1]}th rank`) : "the diagonal";
      const pair = piece === y.type ? `doubles ${PIECE_NAME[piece]}s on ${lineName}` : `lines up ${PIECE_NAME[piece]} and ${PIECE_NAME[y.type]} on ${lineName}`;
      ideas.push(idea("battery", pair, `${cap(pair)}, so the two pieces push in the same direction.`, 10, { arrows: [{ from: next, to: m.to, tone: "opportunity", thin: true }] }));
      break;
    }
  }

  // ---- King: attack and safety ----------------------------------------------------
  if (theirK && piece !== "k") {
    const gain = zonePressure(after, theirK, me) - zonePressure(before, theirK, me);
    const myHits = kingZone(theirK).filter((s) => attacksFrom(after, m.to).includes(s)).length;
    if (gain >= 2 && myHits >= 2 && !moverLoose && !ideas.some((i) => i.kind === "king-attack")) {
      ideas.push(
        idea("king-attack", "joins the attack on the king", `The ${name} joins the attack: it now hits ${myHits} squares around the ${COLOR_NAME[them]} king.`, 12 + Math.min(8, gain), {
          squares: kingZone(theirK)
            .filter((s) => attacksFrom(after, m.to).includes(s))
            .map((s) => ({ sq: s, tone: "danger" as const, style: "hatch" as const })),
        }),
      );
    }
    const flankKing = fileIndex(theirK) <= 2 || fileIndex(theirK) >= 5;
    const flankPawn = fileIndex(m.to) <= 2 || fileIndex(m.to) >= 5;
    if (piece === "p" && flankKing && flankPawn && Math.abs(fileIndex(m.to) - fileIndex(theirK)) <= 1 && relRank(theirK, me) >= 6 && relRank(m.to, me) >= 3) {
      ideas.push(idea("king-attack", "pushes the pawn storm towards the king", `Pushes a pawn towards the ${COLOR_NAME[them]} king, to pry open lines in front of it.`, 9));
    }
  }
  if (m.isCastle) {
    ideas.push(idea("castle", "castles the king to safety", `Castles: the king gets out of the centre and the rook joins the game.`, 12, { arrows: [{ from: m.from, to: m.to, tone: "info" }] }, "info"));
  } else if (piece === "k" && myK) {
    const was = zonePressure(before, m.from, them);
    const now = zonePressure(after, m.to, them);
    if (was - now >= 2) ideas.push(idea("king-safety", "steps the king out of the firing line", `The king steps out of the firing line (fewer enemy pieces aim at it now).`, 12, {}, "info"));
  }
  if (piece === "p" && myK && relRank(myK, me) === 0 && (fileIndex(myK) <= 2 || fileIndex(myK) >= 5) && Math.abs(fileIndex(m.from) - fileIndex(myK)) <= 1 && relRank(m.to, me) === 2) {
    const backRankThreat = ALL_SQUARES.some((s) => after[s]?.color === them && (after[s]!.type === "r" || after[s]!.type === "q"));
    if (backRankThreat) ideas.push(idea("luft", "makes luft for the king", `Makes an escape square for the king, so back-rank checks lose their sting.`, 8, {}, "info"));
  }

  // ---- Pieces: outposts, centre, activity, restriction ------------------------------
  if (moverLoose) {
    // A piece that can simply be taken gets no credit for where it stands.
  } else if ((piece === "n" || piece === "b") && isOutpost(after, m.to, me) && !isOutpost(before, m.from, me)) {
    ideas.push(idea("outpost", `plants the ${name} on the ${m.to} outpost`, `Plants the ${name} on ${m.to}: a pawn defends it and no enemy pawn can chase it away.`, 17, { squares: [{ sq: m.to, tone: "opportunity", style: "fill" }] }));
  } else if (piece === "n" && CENTRE.includes(m.to) && !CENTRE.includes(m.from)) {
    ideas.push(idea("centre", "centralises the knight", `Centralises the knight on ${m.to}, where it reaches the most squares.`, 7));
  }
  if (["n", "b", "r", "q"].includes(piece) && !m.captured && !moverLoose) {
    const worst = worstPiece(before, me);
    const mb = mobility(before, m.from);
    const ma = mobility(after, m.to);
    if (worst === m.from && ma - mb >= 3) {
      ideas.push(idea("activate", `brings the passive ${name} into play`, `Brings the ${name}, ${COLOR_NAME[me]}'s least active piece, into play (from ${mb} to ${ma} usable squares).`, 10));
    } else if (ma - mb >= 5 && !ideas.some((i) => i.kind === "line")) {
      ideas.push(idea("activate", `activates the ${name}`, `Activates the ${name} (from ${mb} to ${ma} usable squares).`, 4));
    }
  }
  // Enemy pieces losing their squares: restriction, or a trapped piece.
  {
    const covered = new Set(attacksFrom(after, m.to));
    for (const sq of ALL_SQUARES) {
      const x = after[sq];
      if (!x || x.color !== them || x.type === "p" || x.type === "k") continue;
      const was = mobility(before, sq);
      const now = mobility(after, sq);
      if (now === 0 && was >= 1 && loose(after, sq) === false && attackersOf(after, sq, me).length) {
        ideas.push(idea("restrict", `traps ${nm(after, sq)}`, `${cap(nm(after, sq))} has no safe square left: it's trapped.`, 26, { squares: [{ sq, tone: "danger", style: "pit" }] }));
        break;
      }
      const lost = safeMobility(before, sq, attacksFrom(before, sq)).filter((t) => covered.has(t) && !safeMobility(after, sq, attacksFrom(after, sq)).includes(t));
      if (x.type === "q" && lost.length >= 1 && !moverLoose) {
        ideas.push(
          idea("restrict", `takes ${lost.slice(0, 2).join(" and ")} away from the queen`, `Takes ${lost.slice(0, 2).join(" and ")} away from the ${COLOR_NAME[them]} queen on ${sq}.`, 7, {
            squares: lost.map((t) => ({ sq: t, tone: "danger" as const, style: "pit" as const })),
            arrows: [{ from: m.to, to: lost[0], tone: "opportunity", thin: true }],
          }),
        );
        break;
      }
      if (lost.length >= 2 && now <= 3) {
        ideas.push(
          idea("restrict", `restricts ${nm(after, sq)}`, `Takes ${lost.slice(0, 3).join(", ")} away from ${nm(after, sq)}, which is left with ${now} usable square${now === 1 ? "" : "s"}.`, 7, {
            squares: lost.map((t) => ({ sq: t, tone: "danger" as const, style: "pit" as const })),
          }),
        );
        break;
      }
    }
  }

  // Prophylaxis: a square the move takes away from enemy pieces that could have used it.
  if (!ideas.some((i) => i.kind === "restrict") && !moverLoose) {
    const covered = new Set(attacksFrom(after, m.to));
    const bySquare = new Map<Square, Square[]>();
    for (const sq of ALL_SQUARES) {
      const x = after[sq];
      if (!x || x.color !== them || x.type === "p" || x.type === "k") continue;
      const lost = safeMobility(before, sq, attacksFrom(before, sq)).filter((t) => covered.has(t) && !safeMobility(after, sq, attacksFrom(after, sq)).includes(t));
      for (const t of lost) bySquare.set(t, [...(bySquare.get(t) ?? []), sq]);
    }
    const top = [...bySquare.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (top && (top[1].length >= 2 || piece === "p")) {
      const [t, pieces] = top;
      ideas.push(
        idea("restrict", `takes ${t} away from ${pieces.map((q) => nm(after, q)).join(" and ")}`, `Takes ${t} away from ${pieces.map((q) => nm(after, q)).join(" and ")}.`, pieces.length >= 2 ? 7 : 5, {
          squares: [{ sq: t, tone: "danger", style: "pit" }, ...pieces.map((q) => ({ sq: q, tone: "danger" as const, style: "ring" as const }))],
          arrows: [{ from: m.to, to: t, tone: "opportunity", thin: true }],
        }),
      );
    }
  }
  // A pawn move that opens a line for one of the mover's long-range pieces.
  if (piece === "p") {
    for (const sq of ALL_SQUARES) {
      const x = after[sq];
      if (!x || x.color !== me || !["b", "q", "r"].includes(x.type)) continue;
      if (!attacksFrom(before, sq).includes(m.from)) continue;
      const gain = attacksFrom(after, sq).length - attacksFrom(before, sq).length;
      if (gain >= 3) {
        ideas.push(idea("activate", `opens a line for ${nm(after, sq)}`, `Opens a line for ${nm(after, sq)}.`, 6, { arrows: [{ from: sq, to: m.from, tone: "opportunity", thin: true }] }));
        break;
      }
    }
  }

  // ---- Pawns -------------------------------------------------------------------------
  if (piece === "p" || m.captured === "p") {
    const pb = classifyPawns(before);
    const pa = classifyPawns(after);
    const mineA = pa.filter((x) => x.color === me);
    const newPassed = mineA.filter((x) => x.passed && !pb.some((y) => y.color === me && y.passed && (y.sq === x.sq || (x.sq === m.to && y.sq === m.from))));
    const passer = newPassed.find((x) => x.sq === m.to || relRank(x.sq, me) >= 3);
    if (passer) ideas.push(idea("passed", `creates a passed pawn on ${passer.sq}`, `Creates a passed pawn on ${passer.sq}: no enemy pawn can stop it any more.`, relRank(passer.sq, me) >= 4 ? 16 : 10, { squares: [{ sq: passer.sq, tone: "opportunity", style: "ring" }] }));
    else if (piece === "p" && pb.some((y) => y.sq === m.from && y.passed)) {
      const rr = relRank(m.to, me);
      ideas.push(idea("passed", `pushes the passed pawn to ${m.to}`, `Pushes the passed pawn to ${m.to}${rr >= 5 ? ", close to promotion" : ""}.`, rr >= 5 ? 20 : 11, { arrows: [{ from: m.from, to: m.to, tone: "opportunity" }] }));
    }
    // Damage done to their structure by a capture.
    if (m.captured) {
      const theirsB = pb.filter((x) => x.color === them);
      const theirsA = pa.filter((x) => x.color === them);
      const doubled = theirsA.find((x) => x.doubled && !theirsB.some((y) => y.sq === x.sq && y.doubled));
      const isolated = theirsA.find((x) => x.isolated && !theirsB.some((y) => y.sq === x.sq && y.isolated));
      if (doubled || isolated) {
        const what = doubled ? `doubles ${COLOR_NAME[them]}'s pawns on the ${FILE(doubled.sq)}-file` : `leaves ${COLOR_NAME[them]} with an isolated pawn on ${isolated!.sq}`;
        ideas.push(idea("structure", what, `${cap(what)}: a long-term weakness.`, 9, { squares: [{ sq: (doubled ?? isolated)!.sq, tone: "danger", style: "ring" }] }));
      }
    }
  }
  if (piece === "p" && !m.captured) {
    const hits = attacksFrom(after, m.to).filter((s) => after[s]?.color === them && after[s]!.type === "p");
    if (hits.length) ideas.push(idea("pawn-break", `challenges ${nm(after, hits[0])}`, `A pawn break: it challenges ${nm(after, hits[0])} to open lines.`, 10, { arrows: [{ from: m.to, to: hits[0], tone: "opportunity" }] }));
    const pieceHits = attacksFrom(after, m.to).filter((s) => after[s]?.color === them && after[s]!.type !== "p" && after[s]!.type !== "k");
    if (pieceHits.length && !ideas.some((i) => i.kind === "fork" || i.kind === "attack"))
      ideas.push(idea("attack", `kicks ${nm(after, pieceHits[0])}`, `The pawn kicks ${nm(after, pieceHits[0])}, which has to move.`, 12, { arrows: [{ from: m.to, to: pieceHits[0], tone: "opportunity" }] }));
    if (relRank(m.to, me) === 4 && !attackersOf(after, m.to, them).some((a) => after[a]!.type === "p") && !ideas.some((i) => i.kind === "pawn-break"))
      ideas.push(idea("space", `gains space on the ${fileIndex(m.to) < 4 ? "queenside" : "kingside"}`, `Gains space: the pawn on ${m.to} cramps ${COLOR_NAME[them]}'s pieces behind it.`, 5));
  }

  // ---- Pressure on a target: piling up attackers --------------------------------------
  if (piece !== "k" && !m.captured && !moverLoose && !ideas.some((i) => ["fork", "attack", "material"].includes(i.kind))) {
    for (const t of attacksFrom(after, m.to)) {
      const x = after[t];
      if (!x || x.color !== them || x.type === "k" || attacksFrom(before, m.from).includes(t)) continue;
      const atk = attackersOf(after, t, me).length;
      const def = attackersOf(after, t, them).length;
      if (atk >= 2 && atk >= def) {
        ideas.push(
          idea("attack", `adds pressure on ${nm(after, t)}`, `Adds a ${atk === def ? "" : "decisive "}attacker on ${nm(after, t)}: ${atk} attackers against ${def} defender${def === 1 ? "" : "s"}.`, atk > def ? 14 : 9, {
            arrows: attackersOf(after, t, me).map((a) => ({ from: a, to: t, tone: "opportunity" as const, thin: a !== m.to })),
            squares: [{ sq: t, tone: "danger", style: "ring" }],
          }),
        );
        break;
      }
    }
  }
  // Shoring up an own pawn or piece that was under as much attack as it had defence.
  if (piece !== "k") {
    for (const t of attacksFrom(after, m.to)) {
      const x = after[t];
      if (!x || x.color !== me || x.type === "k" || attacksFrom(before, m.from).includes(t)) continue;
      const atk = attackersOf(after, t, them).length;
      const defBefore = attackersOf(before, t, me).length;
      if (atk >= 1 && atk >= defBefore && !loose(before, t)) {
        ideas.push(idea("defence", `shores up ${nm(after, t)}`, `Shores up ${nm(after, t)}, which was under as much attack as it had defence (${atk} against ${defBefore}).`, 9, { squares: [{ sq: t, tone: "info", style: "ring" }] }, "info"));
        break;
      }
    }
  }
  // Castling preparation and connecting the rooks.
  {
    const rights = m.fenAfter.split(" ")[2];
    const back = me === "w" ? "1" : "8";
    const k = me === "w" ? "K" : "k";
    const q = me === "w" ? "Q" : "q";
    const clearKing = (files: string) => [...files].every((f) => !after[`${f}${back}` as Square]);
    if (relRank(m.from, me) === 0 && piece !== "k" && piece !== "r") {
      if (rights.includes(k) && "fg".includes(m.from[0]) && clearKing("fg"))
        ideas.push(idea("castle", "clears the way to castle kingside", "Clears the last piece between king and rook: castling kingside is now possible.", 7, {}, "info"));
      else if (rights.includes(q) && "bcd".includes(m.from[0]) && clearKing("bcd"))
        ideas.push(idea("castle", "clears the way to castle queenside", "Clears the last piece between king and rook: castling queenside is now possible.", 7, {}, "info"));
    }
    const rooks = ALL_SQUARES.filter((x) => after[x]?.color === me && after[x]!.type === "r" && relRank(x, me) === 0);
    if (rooks.length === 2 && myK && relRank(myK, me) === 0 && (fileIndex(myK) <= 2 || fileIndex(myK) >= 6)) {
      const connected = between(rooks[0], rooks[1]).every((x) => !after[x]);
      const wasConnected = between(rooks[0], rooks[1]).every((x) => !before[x]) && before[rooks[0]]?.type === "r" && before[rooks[1]]?.type === "r";
      if (connected && !wasConnected) ideas.push(idea("development", "connects the rooks", "Connects the rooks: development is complete and they can now support each other.", 7, {}, "info"));
    }
  }

  // ---- Development (opening) -------------------------------------------------------
  const moveNo = Number(m.fenBefore.split(" ")[5]);
  if (moveNo <= 15 && (piece === "n" || piece === "b") && relRank(m.from, me) === 0 && !m.captured) {
    ideas.push(idea("development", `develops the ${name}`, `Develops the ${name}, bringing another piece into the game.`, moveNo <= 10 ? 9 : 6, {}, "info"));
  }

  // ---- Defence ------------------------------------------------------------------------
  if (loose(before, m.from) && !loose(after, m.to) && piece !== "k") {
    ideas.push(idea("defence", `saves the attacked ${name}`, `Moves the attacked ${name} to safety.`, 14, { arrows: [{ from: m.from, to: m.to, tone: "info" }] }, "info"));
  }
  for (const s of ALL_SQUARES) {
    if (s === m.from || s === m.to || before[s]?.color !== me || !loose(before, s) || loose(after, s)) continue;
    ideas.push(idea("defence", `protects ${nm(after, s)}`, `Protects ${nm(after, s)}, which was hanging.`, 12, { squares: [{ sq: s, tone: "info", style: "ring" }] }, "info"));
    break;
  }

  // ---- Prepares: the engine's next move for the mover, made possible by this one ------------
  const next = ctx.after[1];
  const forced = next ? new Chess(next.fenBefore).inCheck() : false;
  if (next && next.color === me && !next.captured && next.piece !== "k" && !forced) {
    const clears = between(next.from, next.to).includes(m.from);
    const nb = placementFromFen(next.fenBefore);
    const needsCover = attackersOf(nb, next.to, them).length > 0;
    const coverWasThere = attackersOf(before, next.to, me).filter((a) => a !== next.from).length > 0;
    const supports = next.from !== m.to && needsCover && !coverWasThere && attacksFrom(after, m.to).includes(next.to);
    if (clears || supports) {
      const trade = next.piece === "q" && attackersOf(nb, next.to, them).some((a) => nb[a]?.type === "q");
      const purpose = trade ? ", offering a trade of queens" : next.isCheck ? ", with check" : "";
      const lbl = `${next.color === "w" ? "" : "…"}${next.san}`;
      ideas.push(
        idea("prepare", `prepares ${lbl}${purpose}`, `It prepares ${lbl}${purpose}: the ${name} ${clears ? "clears the way" : `covers ${next.to}`}.`, trade ? 16 : 12, {
          arrows: [{ from: next.from, to: next.to, tone: "opportunity", dashed: true }],
        }, "opportunity", "engine"),
      );
    }
  }
  // A rook on a file plus a pawn lever against that file in the engine line: prying the file open.
  if (piece === "r") {
    const f = fileIndex(m.to);
    const lever = ctx.after.slice(0, 8).find((x) => x.color === me && x.piece === "p" && attacksFrom(placementFromFen(x.fenAfter), x.to).some((t) => fileIndex(t) === f && placementFromFen(x.fenAfter)[t]?.type === "p" && placementFromFen(x.fenAfter)[t]?.color === them));
    if (lever) {
      const lbl = `${lever.color === "w" ? "" : "…"}${lever.to}`;
      ideas.push(
        idea("prepare", `backs up the pawn lever ${lbl} to pry open the ${FILE(m.to)}-file`, `The engine follows up with ${lbl}, hitting the pawn on the ${FILE(m.to)}-file: if it opens, the rook is already there.`, 16, {
          arrows: [{ from: lever.from, to: lever.to, tone: "opportunity", dashed: true }],
          bands: [{ kind: "file", index: f, tone: "opportunity" }],
        }, "opportunity", "engine"),
      );
    }
  }

  // ---- Concessions ---------------------------------------------------------------------
  if (loose(after, m.to) && !m.isCheck && swing <= 0 && !ideas.some((i) => i.kind === "material")) {
    const takers = attackersOf(after, m.to, them);
    ideas.push(idea("concession", `leaves the ${name} loose`, `The ${name} on ${m.to} can be taken by ${takers.map((t) => nm(after, t)).join(" or ")}.`, 6, { arrows: takers.map((t) => ({ from: t, to: m.to, tone: "danger" as const })) }, "danger"));
  }
  const castledKing = !!myK && (fileIndex(myK) <= 2 || fileIndex(myK) >= 6);
  if (piece === "p" && myK && castledKing && !ideas.some((i) => i.kind === "luft") && Math.abs(fileIndex(m.from) - fileIndex(myK)) <= 1 && Math.abs(rankIndex(m.from) - rankIndex(myK)) <= 1 && relRank(myK, me) <= 1) {
    ideas.push(idea("concession", "loosens the king's pawn cover", `Moves a pawn from in front of the king, loosening its cover.`, 5, { squares: [{ sq: m.from, tone: "danger", style: "dashed" }] }, "danger"));
  }
  if (!m.isCastle && (piece === "k" || piece === "r")) {
    const rb = m.fenBefore.split(" ")[2];
    const ra = m.fenAfter.split(" ")[2];
    const side = me === "w" ? /[KQ]/g : /[kq]/g;
    if ((rb.match(side) ?? []).length > (ra.match(side) ?? []).length) ideas.push(idea("concession", "gives up castling rights", "Gives up the right to castle.", 4, {}, "danger"));
  }
  const pinnedAfter = piece === "p" ? undefined : findPins(after).find((x) => x.pinned === m.to && after[x.pinner]?.color === them);
  if (pinnedAfter) ideas.push(idea("concession", "walks into a pin", `The ${name} walks into a pin by ${nm(after, pinnedAfter.pinner)}.`, 8, { arrows: [{ from: pinnedAfter.pinner, to: pinnedAfter.behind, tone: "danger", dashed: true }] }, "danger"));

  if (m.isCheck && !ideas.some((i) => i.kind === "material" || i.kind === "fork")) {
    const replies = new Chess(m.fenAfter).moves().length;
    ideas.push(idea("check", replies <= 2 ? `gives check, leaving ${replies === 1 ? "one reply" : "two replies"}` : "gives check", replies <= 2 ? `Check, and ${COLOR_NAME[them]} has only ${replies === 1 ? "one legal reply" : "two legal replies"}.` : "Gives check, so the reply is forced.", replies <= 2 ? 10 : 6));
  }
  // Getting out of check.
  if (new Chess(m.fenBefore).inCheck() && !m.captured) {
    const phrase = piece === "k" ? `steps the king out of check to ${m.to}` : `blocks the check with the ${name}`;
    ideas.push(idea("defence", phrase, piece === "k" ? `The king steps out of check to ${m.to}.` : `The ${name} blocks the check.`, 5, {}, "info"));
  }

  // Quiet moves: say what they lead to, from the engine's next moves for this side.
  if (ctx.goodMove && !ideas.some((i) => i.weight >= 6 && i.tone !== "danger")) {
    const plan = ctx.after.filter((x, i) => x.color === me && !(x.captured && ctx.after[i - 1]?.captured)).slice(0, 2);
    if (plan.length) {
      const lbl = plan.map((x) => `${x.color === "w" ? "" : "…"}${x.san}`).join(" and ");
      ideas.push(
        idea("prepare", `prepares ${lbl}`, `The engine's plan continues with ${lbl}: this move is the first step.`, 8, {
          arrows: plan.map((x) => ({ from: x.from, to: x.to, tone: "opportunity" as const, dashed: true })),
        }, "opportunity", "engine"),
      );
    }
  }
  return ideas.sort((a, b) => b.weight - a.weight);
}
