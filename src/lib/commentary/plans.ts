/**
 * Plans, by type. A plan here is what a player would say out loud ("minority attack",
 * "trade pieces and win the isolated pawn", "get the king to the centre"), with the feature
 * of the position that justifies it, how it is carried out on this board, and what the
 * other side does about it. Every plan is derived from the pawn structure, the kings and
 * the pieces; the engine's lines then say which of them it actually goes for.
 */
import { ALL_SQUARES, attackersOf, attacksFrom, fileIndex, isLightSquare, rankIndex, toSquare } from "../chess/board";
import { COLOR_NAME, PIECE_NAME, other, type Color, type Placement, type Square } from "../chess/types";
import { fileState, isOutpost } from "../facts/activity";
import { movePiece } from "../facts/context";
import { kingZone } from "../facts/king";
import { emptyMarks, type Marks } from "../facts/types";
import { moveLabel } from "../reason/reason";
import { buildVariation } from "../variation";
import { fileLetter, materialWords, rel, relSquare, wingOfFile, type Features, type Wing } from "./features";
import type { EngineRead } from "./kinds";
import { badBishop, cap, downWords, knightDistance, pieceAt, readKing, weakPawns } from "./points";
import { pawnMove, wingFiles, type Structure } from "./structures";
import type { PlanCategory, PlanStep, StrategicPlan } from "./types";

const list = (xs: string[], or = false) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${or ? "or" : "and"} ${xs[xs.length - 1]}`);
const num = (n: number) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"][n] ?? String(n);
const times = (n: number) => (n === 0 ? "not at all" : n === 1 ? "once" : n === 2 ? "twice" : `${num(n)} times`);
const marks = (m: Partial<Marks>): Marks => ({ ...emptyMarks(), ...m });
const step = (text: string, m: Partial<Marks> = {}): PlanStep => ({ text, marks: marks(m) });
const dist = (a: Square, b: Square) => Math.max(Math.abs(fileIndex(a) - fileIndex(b)), Math.abs(rankIndex(a) - rankIndex(b)));

type Draft = Omit<StrategicPlan, "side" | "marks" | "keyUci" | "keySan" | "engine"> & { marks?: Partial<Marks> };

interface Break {
  from: Square;
  to: Square;
  /** Enemy pawns it attacks on arrival. */
  hits: Square[];
  /** Covered at least as often as attacked on arrival. */
  supported: boolean;
  /** One of the four centre files, or aimed at a d- or e-pawn. */
  central: boolean;
}

/** Pawn moves of `c` that put a pawn in contact with an enemy pawn. */
function breaks(f: Features, c: Color): Break[] {
  const o = other(c);
  const out: Break[] = [];
  for (const x of f.of(c).pawns) {
    const file = fileIndex(x.sq);
    const r = rel(x.sq, c);
    for (const n of r === 1 ? [1, 2] : [1]) {
      const to = relSquare(file, r + n, c);
      if (!to || f.p[to]) break;
      const after = movePiece(f.p, x.sq, to);
      const hits = attacksFrom(after, to).filter((s) => f.p[s]?.type === "p" && f.p[s]?.color === o);
      if (!hits.length) continue;
      const mine = attackersOf(after, to, c).length;
      const theirs = attackersOf(after, to, o).length;
      const central = (file >= 2 && file <= 5 && hits.some((h) => fileIndex(h) === 3 || fileIndex(h) === 4)) || file === 3 || file === 4;
      out.push({ from: x.sq, to, hits, supported: mine >= theirs, central });
    }
  }
  return out;
}

/** The shortest knight route to `goal` over squares that aren't occupied by own units or hit by an enemy pawn (up to three moves). */
function knightRoute(p: Placement, from: Square, goal: Square, c: Color): Square[] | null {
  const o = other(c);
  const ok = (s: Square) => s === goal || (!p[s] && !attackersOf(p, s, o).some((a) => p[a]!.type === "p"));
  let frontier: Square[][] = [[from]];
  const seen = new Set<Square>([from]);
  for (let d = 0; d < 3; d++) {
    const next: Square[][] = [];
    for (const path of frontier) {
      const s = path[path.length - 1];
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
        const t = toSquare(fileIndex(s) + df, rankIndex(s) + dr);
        if (!t || seen.has(t) || p[t]?.color === c || !ok(t)) continue;
        if (t === goal) return [...path.slice(1), t];
        seen.add(t);
        next.push([...path, t]);
      }
    }
    frontier = next;
  }
  return null;
}

/** The pawn's next move as a plan's first move: two squares from its starting rank when the way is clear. */
function firstPush(f: Features, from: Square, c: Color): { from: Square; to: Square } | undefined {
  const file = fileIndex(from);
  const r = rel(from, c);
  const one = relSquare(file, r + 1, c);
  if (!one || f.p[one]) return undefined;
  const two = r === 1 ? relSquare(file, r + 2, c) : null;
  return { from, to: two && !f.p[two] ? two : one };
}

const isMinor = (t: string) => t === "n" || t === "b";

const routeArrows = (from: Square, route: Square[]) => [from, ...route].slice(0, -1).map((s, i) => ({ from: s, to: route[i], tone: "idea" as const, dashed: true }));

export function sidePlans(f: Features, structures: Structure[], c: Color): StrategicPlan[] {
  const me = f.of(c);
  const them = f.of(other(c));
  const o = other(c);
  const N = COLOR_NAME;
  const out: Draft[] = [];
  const endish = f.phase === "endgame" || f.phase === "queenless";
  const myKing = readKing(f, c);
  const theirKing = readKing(f, o);
  const mw = materialWords(f);
  const ahead = mw && mw.points >= 2 && mw.side === c;
  const behind = mw && mw.points >= 2 && mw.side === o;
  const myBreaks = breaks(f, c);
  const pm = (sq: Square | null) => pawnMove(c, sq);
  const add = (d: Draft) => out.push(d);
  const pawnOn = (files: number[]) => (m: { from: Square; piece: string }) => m.piece === "p" && files.includes(fileIndex(m.from));

  // ---- Defend first -------------------------------------------------------
  if (myKing.problem === "uncastled") {
    const side = me.canCastle.k ? "kingside" : "queenside";
    const kingTo = relSquare(side === "kingside" ? 6 : 2, 0, c)!;
    add({
      id: "castle",
      category: "defend",
      title: "Get castled",
      why: `The king is still on ${me.king} with the queens on, and ${N[o]} is ready to open the centre.`,
      steps: [step(`Castle ${side} as soon as the squares between king and rook are clear and safe.`, { arrows: [{ from: me.king, to: kingTo, tone: "idea", dashed: true }] })],
      risk: `Everything else waits: a pawn won with the king in the middle is often a pawn that costs the game.`,
      weight: 70,
      key: { from: me.king, to: kingTo },
      match: (m) => m.piece === "k" && Math.abs(fileIndex(m.to) - fileIndex(m.from)) === 2,
    });
  }
  if (myKing.problem === "stuck") {
    const wing = me.wingPawns.kingside >= me.wingPawns.queenside ? "kingside" : "queenside";
    add({
      id: "king-by-hand",
      category: "defend",
      title: "Walk the king to safety",
      why: `The king can't castle and the queens are on. It has to reach the ${wing} by hand, behind the pawns still standing there.`,
      steps: [
        step(`Step the king towards the ${wing}, one square at a time, and bring the rook out afterwards.`, { squares: [{ sq: me.king, tone: "danger", style: "ring" }] }),
        step(`Until it gets there, keep the centre closed: no pawn trades in the middle, and no pawn-grabbing.`),
      ],
      risk: `It costs two or three moves. ${N[o]} will try to open the centre in exactly that time.`,
      weight: myKing.weight,
      match: (m) => m.piece === "k",
    });
  }
  if (myKing.problem === "attacked" || myKing.problem === "thin") {
    const queenTrade = me.counts.q > 0 && them.counts.q > 0;
    add({
      id: "king-defence",
      category: "defend",
      title: queenTrade ? "Trade off the attackers" : "Bring a defender to the king",
      why: `${cap(num(myKing.attackers.length))} ${N[o]} piece${myKing.attackers.length === 1 ? " aims" : "s aim"} at the king against ${num(myKing.defenders.length)} defender${myKing.defenders.length === 1 ? "" : "s"}.`,
      steps: [
        ...(queenTrade ? [step(`Offer the queens: without them the attack has no finish.`, { squares: [...me.queens, ...them.queens].map((sq) => ({ sq, tone: "info" as const, style: "ring" as const })) })] : []),
        step(`Challenge the piece closest to the king${myKing.attackers[0] ? `, ${pieceAt(f, myKing.attackers[0])}` : ""}; each attacker traded is one fewer than the attack needs.`, {
          squares: myKing.attackers.slice(0, 3).map((sq) => ({ sq, tone: "danger" as const, style: "ring" as const })),
        }),
        step(`Don't move the pawns in front of the king unless forced: every pawn move there makes a new square to attack.`, { squares: me.shelter.map((sq) => ({ sq, tone: "info" as const, style: "ring" as const })) }),
      ],
      weight: myKing.weight,
      match: (m) => !!m.captured && myKing.attackers.includes(m.to),
    });
  }
  if (behind) {
    add({
      id: "keep-pieces",
      category: "defend",
      title: "Keep pieces on, trade pawns",
      why: `${N[c]} is ${downWords(mw!.text)}. A simpler position only makes that clearer.`,
      steps: [step(`Avoid piece trades: every piece kept is a chance to complicate.`), step(`Trade pawns where possible. With few pawns left, extra material often isn't enough to win.`)],
      risk: `Playing normally and hoping loses slowly. Look for activity, even at the cost of another pawn.`,
      weight: 58,
    });
  }
  for (const x of them.pawns.filter((y) => y.passed && rel(y.sq, o) >= 3).slice(0, 1)) {
    const stop = relSquare(fileIndex(x.sq), rel(x.sq, o) + 1, o);
    if (!stop) continue;
    add({
      id: `blockade-${x.sq}`,
      category: "defend",
      title: `Block the ${fileLetter(fileIndex(x.sq))}-pawn`,
      why: `${N[o]}'s passed pawn on ${x.sq} has to be stopped by a piece, and the best place is the square right in front of it.`,
      steps: [
        step(`Put a piece on ${stop} and keep it there. A knight is the ideal blocker: the pawn shields it from the front and it still works from there.`, { squares: [{ sq: stop, tone: "opportunity", style: "dashed" }, { sq: x.sq, tone: "danger", style: "ring" }] }),
        step(`Then attack the pawn from the side or from behind; a blocked passed pawn can turn into a weakness.`),
      ],
      weight: 34 + 7 * Math.max(0, rel(x.sq, o) - 3) + (endish ? 10 : 0),
      match: (m) => m.to === stop && m.piece !== "p",
    });
  }

  // ---- Attack the king ----------------------------------------------------
  if (f.phase !== "endgame" && f.queensOn && me.castled && them.castled && me.kingWing !== them.kingWing) {
    const files = wingFiles(them.kingWing).slice(0, 2);
    const stormers = me.pawns.filter((x) => files.includes(fileIndex(x.sq)) || fileIndex(x.sq) === wingFiles(them.kingWing)[2]).sort((a, b) => rel(b.sq, c) - rel(a.sq, c));
    const order = [wingFiles(them.kingWing)[1], wingFiles(them.kingWing)[0], wingFiles(them.kingWing)[2]];
    const lead = order.map((file) => stormers.find((x) => fileIndex(x.sq) === file)).find((x) => x && firstPush(f, x.sq, c));
    const names = `${files.map(fileLetter).sort().join("- and ")}-pawns`;
    if (stormers.length) {
      const push = lead ? firstPush(f, lead.sq, c) : undefined;
      add({
        id: "pawn-storm",
        category: "attack",
        title: `Pawn storm on the ${them.kingWing}`,
        why: `The kings are on opposite wings, so ${N[c]}'s ${names} can run at ${N[o]}'s king without exposing their own.`,
        steps: [
          step(`Advance the ${names}. Where one of them meets a ${N[o]} pawn, a file opens at the king.`, {
            arrows: stormers.slice(0, 3).flatMap((x) => {
              const t = relSquare(fileIndex(x.sq), Math.min(6, rel(x.sq, c) + 2), c);
              return t && t !== x.sq ? [{ from: x.sq, to: t, tone: "idea" as const, dashed: true }] : [];
            }),
            squares: [{ sq: them.king, tone: "danger", style: "ring" }],
          }),
          step(`Put the rooks behind them and the queen nearby: the pawns open the file, the heavy pieces use it.`),
        ],
        risk: `${N[o]} is doing the same on the other wing. Count the moves each attack needs: usually whoever opens a file first wins, and a move spent on defence is a move lost.`,
        weight: 66,
        key: push,
        match: pawnOn(wingFiles(them.kingWing)),
      });
    }
  } else if (theirKing.problem === "thin" || theirKing.problem === "attacked") {
    const zone = [them.king, ...kingZone(them.king)];
    const waiting = me.activity
      .filter((x) => !theirKing.attackers.includes(x.sq) && x.piece.type !== "q")
      .sort((a, b) => dist(a.sq, them.king) - dist(b.sq, them.king))[0];
    add({
      id: "king-attack",
      category: "attack",
      title: `Attack ${N[o]}'s king`,
      why: `${theirKing.problem === "attacked" ? `${cap(num(theirKing.attackers.length))} pieces already bear on it against ${num(theirKing.defenders.length)} defender${theirKing.defenders.length === 1 ? "" : "s"}` : `Its pawn cover is down to ${num(them.shelter.length)}`}${theirKing.openFiles.length ? `, and the ${theirKing.openFiles.map(fileLetter).join("- and ")}-file is open` : ""}.`,
      steps: [
        ...(waiting ? [step(`Bring ${pieceAt(f, waiting.sq)} over: an attack needs more attackers than there are defenders.`, { arrows: [{ from: waiting.sq, to: them.king, tone: "idea", dashed: true }] })] : []),
        step(`Trade or drive off the defenders${theirKing.defenders[0] ? `, starting with ${pieceAt(f, theirKing.defenders[0])}` : ""}.`, { squares: theirKing.defenders.slice(0, 2).map((sq) => ({ sq, tone: "danger" as const, style: "ring" as const })) }),
        step(`Keep the queens on. If ${N[o]} can trade them, the attack is over.`),
      ],
      risk: `Count before sacrificing: the pieces given up have to be outnumbered by the ones that arrive.`,
      weight: theirKing.weight + 4,
      marks: { squares: [{ sq: them.king, tone: "danger", style: "pulse" }], arrows: theirKing.attackers.slice(0, 4).map((from) => ({ from, to: them.king, tone: "danger" as const, thin: true })) },
      match: (m) => m.piece !== "p" && m.piece !== "k" && zone.some((z) => dist(m.to, z) <= 1),
    });
  }
  if (theirKing.problem === "stuck" || theirKing.problem === "uncastled") {
    const central = myBreaks.filter((b) => b.central).sort((a, b) => Number(b.supported) - Number(a.supported))[0];
    const kf = fileIndex(them.king);
    add({
      id: "open-centre-on-king",
      category: "attack",
      title: "Open the centre on the king",
      why: `${N[o]}'s king is on ${them.king}${theirKing.problem === "stuck" ? " and can't castle" : " and hasn't castled"}. Every file that opens there points straight at it.`,
      steps: [
        ...(central ? [step(`Break with ${pm(central.to)}: if pawns come off, lines open towards the king.`, { arrows: [{ from: central.from, to: central.to, tone: "idea", dashed: true }] })] : [step(`Look for a pawn break in the centre, even one that costs a pawn.`)]),
        step(`Put a rook on the ${fileLetter(kf)}-file, opposite the king.`, { bands: [{ kind: "file", index: kf, tone: "danger" }] }),
      ],
      risk:
        theirKing.problem === "uncastled"
          ? `It only works while the king is still there. Don't give ${N[o]} the quiet move it needs to castle.`
          : `There's no need to rush with checks: bring the pieces first, the king isn't going anywhere.`,
      weight: theirKing.weight + 6,
      key: central ? { from: central.from, to: central.to } : undefined,
      match: (m) => (central ? m.from === central.from && m.to === central.to : false) || (m.piece === "r" && fileIndex(m.to) === kf),
    });
  }

  // ---- Structure plans ----------------------------------------------------
  const carlsbad = structures.find((s) => s.id === "carlsbad");
  if (carlsbad && f.phase !== "endgame") {
    if (carlsbad.side === c) {
      const b = relSquare(1, Math.max(...me.pawnRanks[1]), c)!;
      const b4 = relSquare(1, 3, c)!;
      const b5 = relSquare(1, 4, c)!;
      const cTarget = relSquare(2, 5, c)!;
      add({
        id: "minority-attack",
        category: "wing",
        title: "Minority attack",
        why: `${N[c]} has two queenside pawns against three. They aren't pushed to win a race: when the b-pawn reaches ${b5} and trades itself off, ${N[o]} is left with a weak pawn on the c- or d-file, on a file ${N[c]}'s rooks already hold.`,
        steps: [
          step(`Advance the b-pawn to ${b4} and ${b5}, usually with a rook behind it on the b-file.`, { arrows: [{ from: b, to: b5, tone: "idea", dashed: true }] }),
          step(`Trade on ${cTarget}. Whichever way ${N[o]} recaptures, a pawn is left that no pawn can defend.`, { squares: [{ sq: cTarget, tone: "danger", style: "ring" }] }),
          step(`Then pile up on it along the c-file.`, { bands: [{ kind: "file", index: 2, tone: "opportunity" }] }),
        ],
        risk: `It is slow, and ${N[o]} uses the time on the other wing. Keep enough pieces near the king.`,
        weight: 56,
        key: firstPush(f, b, c),
        match: (m) => (m.piece === "p" && fileIndex(m.from) <= 1) || (m.piece === "r" && fileIndex(m.to) === 1),
      });
    } else {
      // The square in front of the other side's e-pawn: only its f-pawn could ever cover it.
      const e4 = relSquare(4, Math.max(...them.pawnRanks[4]) + 1, o)!;
      add({
        id: "carlsbad-kingside",
        category: "wing",
        title: "Play on the e-file and the kingside",
        why: `${N[c]}'s half-open file is the e-file, and the square at the end of it, ${e4}, can only be covered by a ${N[o]} pawn if the f-pawn moves. That is the natural home for a knight.`,
        steps: [
          step(`Put a knight on ${e4}.`, { squares: [{ sq: e4, tone: "opportunity", style: "dashed" }] }),
          step(`Rooks to the e-file; then the f-pawn or the pieces go at the king.`, { bands: [{ kind: "file", index: 4, tone: "opportunity" }] }),
        ],
        risk: `${N[o]}'s queenside pawns are coming. Meet the b-pawn's advance in time, so that the pawn left behind afterwards can be defended.`,
        weight: 48,
        match: (m) => (m.piece === "n" && m.to === e4) || (m.piece === "r" && fileIndex(m.to) === 4),
      });
    }
  }

  const chain = structures.find((s) => s.id === "chain")?.chain;
  if (chain && f.phase !== "endgame") {
    const mine = chain[c];
    const theirs = chain[o];
    const atKing = them.kingWing === mine.wing && f.queensOn;
    const leverFile = mine.wing === "queenside" ? 2 : 5;
    const nextFile = mine.wing === "queenside" ? 1 : 6;
    const leverFrom = me.pawnRanks[leverFile].length ? relSquare(leverFile, Math.max(...me.pawnRanks[leverFile]), c) : null;
    // The lever does its work from beside the pawn it attacks: one rank short of it.
    const need = mine.target ? rel(mine.target, c) - 1 : null;
    const at = leverFrom ? rel(leverFrom, c) : null;
    const contactSq = need != null ? relSquare(leverFile, need, c) : null;
    const state = at == null || need == null ? "gone" : at < need ? "coming" : at === need ? "contact" : "past";
    const leverStep =
      state === "coming"
        ? step(`The lever is the ${fileLetter(leverFile)}-pawn: get it to ${pm(contactSq)}, where it attacks the pawn on ${mine.target}, the base of ${N[o]}'s chain.`, {
            arrows: leverFrom && contactSq ? [{ from: leverFrom, to: contactSq, tone: "idea", dashed: true }] : [],
            squares: mine.target ? [{ sq: mine.target, tone: "danger", style: "ring" }] : [],
          })
        : state === "contact"
          ? step(`The ${fileLetter(leverFile)}-pawn already attacks ${mine.target}, the base of ${N[o]}'s chain. Keep adding pressure on that pawn; trade there when the open ${fileLetter(leverFile)}-file suits ${N[c]}, or push past and bring the ${fileLetter(nextFile)}-pawn up behind it.`, {
              squares: mine.target ? [{ sq: mine.target, tone: "danger", style: "ring" }] : [],
              arrows: leverFrom && mine.target ? [{ from: leverFrom, to: mine.target, tone: "idea", dashed: true }] : [],
            })
          : step(`The ${fileLetter(leverFile)}-pawn has ${state === "past" ? "gone past" : "been traded"}. The next lever is the ${fileLetter(nextFile)}-pawn: advance it until it meets a ${N[o]} pawn and a file opens.`, {
              arrows: me.pawnRanks[nextFile].length ? [{ from: relSquare(nextFile, Math.max(...me.pawnRanks[nextFile]), c)!, to: relSquare(nextFile, Math.min(5, Math.max(...me.pawnRanks[nextFile]) + 2), c)!, tone: "idea", dashed: true }] : [],
            });
    const keyFrom = state === "coming" ? leverFrom : state === "past" || state === "gone" ? (me.pawnRanks[nextFile].length ? relSquare(nextFile, Math.max(...me.pawnRanks[nextFile]), c) : null) : null;
    add({
      id: "chain-wing",
      category: atKing ? "attack" : "wing",
      title: atKing ? `Attack on the ${mine.wing}` : `Play on the ${mine.wing}`,
      why: `${N[c]}'s pawn chain points at the ${mine.wing}: that is where ${N[c]} has more room${atKing ? `, and ${N[o]}'s king lives there` : ""}. The centre is locked, so nothing can punish a slow build-up.`,
      steps: [leverStep, step(`When a file opens there, the rooks go to it${atKing ? " and the pieces follow the pawns towards the king" : ""}.`, { bands: [{ kind: "file", index: leverFile, tone: "opportunity" }] })],
      risk: `${N[o]} does the same on the ${theirs.wing}. ${theirs.wing === me.kingWing && f.queensOn ? `That attack is aimed at ${N[c]}'s king, so ${N[c]} has to be faster or leave a defender behind.` : `It is a race of who breaks through first.`}`,
      weight: atKing ? 62 : 54,
      key: keyFrom ? firstPush(f, keyFrom, c) : undefined,
      match: pawnOn(wingFiles(mine.wing)),
    });
  }

  const iqp = structures.find((s) => s.id === "iqp");
  if (iqp && !endish) {
    const owner = iqp.side;
    const sq = relSquare(3, f.of(owner).pawnRanks[3][0], owner)!;
    const front = relSquare(3, rel(sq, owner) + 1, owner)!;
    if (owner === c) {
      const canPush = !f.p[front];
      add({
        id: "iqp-activity",
        category: "attack",
        title: "Use the isolated pawn's activity",
        why: `The d-pawn gives ${N[c]} more space, the half-open c- and e-files and squares for the knights in front of them. That is worth more than the pawn's weakness only while there are pieces to use it.`,
        steps: [
          step(`Knights towards ${relSquare(4, rel(sq, c) + 1, c)} and ${relSquare(2, rel(sq, c) + 1, c)}, rooks on the c- and e-files.`, {
            squares: [relSquare(4, rel(sq, c) + 1, c), relSquare(2, rel(sq, c) + 1, c)].filter((s): s is Square => !!s).map((s) => ({ sq: s, tone: "opportunity" as const, style: "dashed" as const })),
          }),
          step(`Aim at the kingside, or push ${pm(front)}${canPush ? "" : " once the blocker is gone"}: if the pawn trades itself off, the weakness is gone and the active pieces stay.`, { arrows: [{ from: sq, to: front, tone: "idea", dashed: true }] }),
        ],
        risk: `Avoid trades. Every minor piece that comes off leaves less activity and the same weak pawn.`,
        weight: 54,
        key: canPush ? { from: sq, to: front } : undefined,
        match: (m) => m.from === sq || (m.piece === "n" && dist(m.to, front) <= 1),
      });
    } else {
      add({
        id: "iqp-blockade",
        category: "target",
        title: "Block the isolated pawn, then win it",
        why: `${N[o]}'s d-pawn can't be defended by a pawn, and ${front}, the square in front of it, can't be attacked by one.`,
        steps: [
          step(`Occupy ${front} with a piece, best a knight. The pawn can't advance and everything behind it is tied to it.`, { squares: [{ sq: front, tone: "opportunity", style: "dashed" }, { sq, tone: "danger", style: "ring" }] }),
          step(`Trade minor pieces: each one that goes takes some of ${N[o]}'s activity with it.`),
          step(`With fewer pieces on, line up on the d-file and attack the pawn more often than it can be defended.`, { bands: [{ kind: "file", index: 3, tone: "opportunity" }] }),
        ],
        risk: `Until the pieces are off, ${N[o]} has the freer game and chances at the king. Don't let the pawn advance and trade itself.`,
        weight: 54,
        match: (m) => m.to === front || (!!m.captured && m.piece !== "p" && m.piece !== "k" && m.piece !== "q" && m.piece !== "r"),
      });
    }
  }

  const benoni = structures.find((s) => s.id === "benoni");
  if (benoni && f.phase !== "endgame") {
    const owner = benoni.side;
    if (owner === c) {
      const e = relSquare(4, Math.max(...me.pawnRanks[4]), c)!;
      const e5 = relSquare(4, 4, c)!;
      add({
        id: "benoni-centre",
        category: "centre",
        title: `Push through with ${pm(e5)}`,
        why: `${N[c]} has two pawns in the centre against one. If the e-pawn gets to ${e5} with support, it breaks ${N[o]}'s position in two.`,
        steps: [step(`Prepare it with the f-pawn and the pieces behind, then play ${pm(e5)}.`, { arrows: e !== e5 ? [{ from: e, to: e5, tone: "idea", dashed: true }] : [] })],
        risk: `${N[o]} will blockade on ${e5} and advance on the queenside. Don't let the queenside pawns run while the centre is still being prepared.`,
        weight: 52,
        key: rel(e, c) === 3 && !f.p[e5] ? { from: e, to: e5 } : undefined,
        match: pawnOn([4, 5]),
      });
    } else {
      add({
        id: "benoni-queenside",
        category: "wing",
        title: "Advance the queenside majority",
        why: `${N[c]} has the extra pawn on the queenside and the long diagonal behind it. A pawn on ${relSquare(1, 4, c)} loosens ${N[o]}'s centre from the side.`,
        steps: [step(`Prepare and play ${pm(relSquare(1, 4, c))} with the a-pawn and a rook on the b-file.`, { arrows: me.pawnRanks[1].length ? [{ from: relSquare(1, Math.max(...me.pawnRanks[1]), c)!, to: relSquare(1, 4, c)!, tone: "idea", dashed: true }] : [] })],
        risk: `Keep ${relSquare(4, 4, c)} under control: if ${N[o]}'s e-pawn gets there with support, the centre decides before the queenside does.`,
        weight: 50,
        match: pawnOn([0, 1]),
      });
    }
  }

  const hanging = structures.find((s) => s.id === "hanging");
  if (hanging && f.phase !== "endgame") {
    const owner = f.of(hanging.side);
    const cSq = relSquare(2, Math.max(...owner.pawnRanks[2]), hanging.side)!;
    const dSq = relSquare(3, Math.max(...owner.pawnRanks[3]), hanging.side)!;
    if (hanging.side === c) {
      const d5 = relSquare(3, rel(dSq, c) + 1, c)!;
      add({
        id: "hanging-advance",
        category: "centre",
        title: `Advance with ${pm(d5)} at the right moment`,
        why: `Side by side, the c- and d-pawns control every square in front of them and give the pieces room. Their strength is the threat to advance: a well-timed ${pm(d5)} opens the lines behind them all at once.`,
        steps: [
          step(`Keep the pawns abreast and the pieces behind them: rooks on the c- and d-files, bishops aimed at the kingside.`, { squares: [cSq, dSq].map((sq) => ({ sq, tone: "opportunity" as const, style: "ring" as const })) }),
          step(`Push ${pm(d5)} when the pieces are ready to use the open lines. Pushed too early, it just leaves a hole behind.`, { arrows: [{ from: dSq, to: d5, tone: "idea", dashed: true }] }),
        ],
        risk: `If one of them is forced forward at a bad moment, the other is left backward and the square in front of it belongs to ${N[o]}.`,
        weight: 52,
        key: !f.p[d5] ? { from: dSq, to: d5 } : undefined,
        match: (m) => m.from === dSq || m.from === cSq,
      });
    } else {
      add({
        id: "hanging-pressure",
        category: "target",
        title: "Make the hanging pawns move",
        why: `${N[o]}'s pawns on ${cSq} and ${dSq} have no pawn beside them, so pieces have to defend them. Attack both until one has to advance; the one left behind is then backward on a half-open file.`,
        steps: [
          step(`Rooks to the c- and d-files, minor pieces aimed at ${cSq} and ${dSq}.`, { squares: [cSq, dSq].map((sq) => ({ sq, tone: "danger" as const, style: "ring" as const })), bands: [{ kind: "file", index: 2, tone: "opportunity" }, { kind: "file", index: 3, tone: "opportunity" }] }),
          step(`When one advances, put a piece on the square in front of the other and attack the one that stayed.`),
        ],
        risk: `While they stand abreast they are strong, and the advance can come with tempo. Keep the squares in front of them covered.`,
        weight: 50,
        match: (m) => (m.piece === "r" && (fileIndex(m.to) === 2 || fileIndex(m.to) === 3)) || attacksFrom(movePiece(f.p, m.from, m.to), m.to).some((t) => t === cSq || t === dSq),
      });
    }
  }

  const sicilian = structures.find((s) => s.id === "sicilian");
  if (sicilian && f.phase !== "endgame" && sicilian.side === o) {
    const b = me.pawnRanks[1].length ? relSquare(1, Math.max(...me.pawnRanks[1]), c) : null;
    add({
      id: "sicilian-c-file",
      category: "wing",
      title: "Play on the c-file and the queenside",
      why: `The half-open c-file belongs to ${N[c]} by structure, and the a- and b-pawns can advance to gain room and disturb the pieces that guard ${N[o]}'s centre.`,
      steps: [
        step(`A rook to the c-file, pressing down it.`, { bands: [{ kind: "file", index: 2, tone: "opportunity" }] }),
        step(`Advance the b-pawn with the a-pawn's support${b ? "" : " if it is still there"}: it gains space and can chase a knight off the c-file.`, { arrows: b && firstPush(f, b, c) ? [{ from: b, to: firstPush(f, b, c)!.to, tone: "idea", dashed: true }] : [] }),
      ],
      risk: `${N[o]} plays on the other side, often straight at the king. The queenside play has to be fast enough to matter.`,
      weight: 46,
      match: (m) => (m.piece === "r" && fileIndex(m.to) === 2) || (m.piece === "p" && fileIndex(m.from) <= 1),
    });
  }

  if (f.centre.kind === "mobile" && f.phase !== "endgame") {
    const owner = f.centre.mobileSide!;
    const pawns = [3, 4].map((file) => relSquare(file, Math.max(...f.of(owner).pawnRanks[file]), owner)!);
    if (owner === c) {
      const pushes = pawns.map((sq) => ({ sq, to: relSquare(fileIndex(sq), rel(sq, c) + 1, c)! })).filter((x) => !f.p[x.to]);
      const safe = pushes.find((x) => attackersOf(movePiece(f.p, x.sq, x.to), x.to, c).length >= attackersOf(movePiece(f.p, x.sq, x.to), x.to, o).length);
      add({
        id: "centre-roll",
        category: "centre",
        title: "Advance the centre pawns",
        why: `${N[c]}'s pawns on ${pawns.join(" and ")} stand side by side with nothing in front of them. Each step forward takes squares from ${N[o]}'s pieces and can come with a gain of time on a knight.`,
        steps: [
          step(`Support them with pieces first, so that neither can be picked off once it advances.`, { squares: pawns.map((sq) => ({ sq, tone: "opportunity" as const, style: "ring" as const })) }),
          step(pushes.length ? `Then push ${list(pushes.map((x) => pm(x.to)), true)}, choosing the one that hits a piece or opens a line for the bishops.` : `Clear the squares in front of them and push when a piece can be hit.`, {
            arrows: pushes.map((x) => ({ from: x.sq, to: x.to, tone: "idea" as const, dashed: true })),
          }),
        ],
        risk: `A centre that advances too early leaves holes behind it and becomes a target. Keep the two pawns abreast until the push achieves something.`,
        weight: 50,
        key: safe ? { from: safe.sq, to: safe.to } : undefined,
        match: (m) => pawns.includes(m.from) && m.piece === "p",
      });
    } else {
      add({
        id: "centre-hit",
        category: "centre",
        title: "Hit the pawn centre before it advances",
        why: `${N[o]}'s pawns on ${pawns.join(" and ")} take space now and threaten to take more. Left alone they roll forward; attacked by pawns and pieces, one of them has to commit and the squares beside it become ${N[c]}'s.`,
        steps: [
          step(`Attack them with a pawn from the side${myBreaks.filter((b) => b.hits.some((h) => pawns.includes(h))).length ? `: ${list(myBreaks.filter((b) => b.hits.some((h) => pawns.includes(h))).slice(0, 2).map((b) => pm(b.to)), true)}` : ""}.`, {
            arrows: myBreaks.filter((b) => b.hits.some((h) => pawns.includes(h))).slice(0, 2).map((b) => ({ from: b.from, to: b.to, tone: "idea" as const, dashed: true })),
            squares: pawns.map((sq) => ({ sq, tone: "danger" as const, style: "ring" as const })),
          }),
          step(`Add pieces against whichever pawn can't be supported by another pawn.`),
        ],
        risk: `Timing matters: the same break played a move late lets the pawn advance past it.`,
        weight: 50,
        key: myBreaks.filter((b) => b.hits.some((h) => pawns.includes(h))).sort((a, b) => Number(b.supported) - Number(a.supported)).map((b) => ({ from: b.from, to: b.to }))[0],
        match: (m) => m.piece === "p" && myBreaks.some((b) => b.from === m.from && b.to === m.to && b.hits.some((h) => pawns.includes(h))),
      });
    }
  }

  // A pawn already far up the board on the wing where the other king lives: the pawns beside it follow.
  if (f.queensOn && f.phase !== "endgame" && them.castled && !out.some((d) => d.id === "pawn-storm" || d.id === "chain-wing")) {
    const files = wingFiles(them.kingWing);
    const spear = me.pawns.filter((x) => files.includes(fileIndex(x.sq)) && rel(x.sq, c) >= 4).sort((a, b) => rel(b.sq, c) - rel(a.sq, c))[0];
    const next = spear ? me.pawns.filter((x) => files.includes(fileIndex(x.sq)) && x.sq !== spear.sq && Math.abs(fileIndex(x.sq) - fileIndex(spear.sq)) === 1 && firstPush(f, x.sq, c)).sort((a, b) => rel(b.sq, c) - rel(a.sq, c))[0] : undefined;
    if (spear && next) {
      const own = me.kingWing === them.kingWing;
      add({
        id: "wing-advance",
        category: "attack",
        title: `Pawn advance on the ${them.kingWing}`,
        why: `The pawn on ${spear.sq} already takes squares from the pieces around ${N[o]}'s king. Bringing the ${fileLetter(fileIndex(next.sq))}-pawn up beside it drives the defenders back and, where the pawns meet, opens a file.`,
        steps: [
          step(`Advance the ${fileLetter(fileIndex(next.sq))}-pawn, with pieces ready to use the squares it wins.`, { arrows: [{ from: next.sq, to: firstPush(f, next.sq, c)!.to, tone: "idea", dashed: true }], squares: [{ sq: spear.sq, tone: "opportunity", style: "ring" }, { sq: them.king, tone: "danger", style: "ring" }] }),
          step(`When a file opens at the king, the heavy pieces go to it.`),
        ],
        risk: own
          ? `These are the pawns in front of ${N[c]}'s own king. It works while the centre is under control; if ${N[o]} can open the middle, the advanced pawns leave that king bare.`
          : `${N[o]} will look for counterplay in the centre: the classic answer to a wing attack.`,
        weight: 42,
        key: firstPush(f, next.sq, c),
        match: pawnOn(files),
      });
    }
  }

  // ---- Pawn breaks not already covered by a structure ---------------------
  const used = new Set(out.flatMap((d) => (d.key ? [`${d.key.from}${d.key.to}`] : [])));
  const centralBreak = myBreaks.filter((b) => b.central && !used.has(`${b.from}${b.to}`)).sort((a, b) => Number(b.supported) - Number(a.supported) || Math.abs(3.5 - fileIndex(a.to)) - Math.abs(3.5 - fileIndex(b.to)))[0];
  if (centralBreak && f.phase !== "endgame" && !chain && !out.some((d) => d.id === "open-centre-on-king")) {
    const cramped = them.space - me.space >= 5;
    const lead = me.developed - them.developed >= 2;
    const pair = me.bishopPair && !them.bishopPair;
    const opens = fileLetter(fileIndex(centralBreak.hits[0]));
    const own = me.pawns.find((x) => x.sq === centralBreak.from);
    const cures = !!own && (own.backward || own.isolated);
    add({
      id: `break-${centralBreak.to}`,
      category: "centre",
      title: cramped ? `The freeing break ${pm(centralBreak.to)}` : `Break with ${pm(centralBreak.to)}`,
      why: cures
        ? `The ${fileLetter(fileIndex(centralBreak.from))}-pawn is ${own!.backward ? "backward" : "isolated"} where it stands. If it can get to ${centralBreak.to} and trade itself off, ${N[c]}'s one weakness is gone and the pieces behind it come to life.`
        : cramped
        ? `${N[c]} has less room. A pawn on ${centralBreak.to} challenges the pawn on ${centralBreak.hits[0]} that does the cramping; once it is traded the pieces have squares.`
        : lead
          ? `${N[c]} has more pieces out. Opening the centre now lets them act before ${N[o]} has caught up.`
          : pair
            ? `${N[c]} has the bishop pair, and bishops need open lines. The break ${pm(centralBreak.to)} starts opening them.`
            : `A pawn on ${centralBreak.to} challenges the one on ${centralBreak.hits[0]}. If pawns are traded the ${opens}-file opens; if ${N[o]} lets it stand, the tension is ${N[c]}'s to resolve.`,
      steps: [
        step(
          centralBreak.supported ? `The square ${centralBreak.to} is covered as often as it is attacked, so the break can be played when the moment is right.` : `Prepare it first: ${centralBreak.to} is attacked more often than it is covered.`,
          { arrows: [{ from: centralBreak.from, to: centralBreak.to, tone: "idea", dashed: true }], squares: centralBreak.hits.map((sq) => ({ sq, tone: "danger" as const, style: "ring" as const })) },
        ),
        step(`Have a rook ready for the ${opens}-file before it opens.`, { bands: [{ kind: "file", index: fileIndex(centralBreak.hits[0]), tone: "info" }] }),
      ],
      risk: `A break also opens lines for the other side. Check whose pieces are better placed for the open position before playing it.`,
      weight: 36 + (cramped ? 12 : 0) + (lead ? 10 : 0) + (pair ? 8 : 0) + (centralBreak.supported ? 4 : 0) + (cures ? 10 : 0),
      key: { from: centralBreak.from, to: centralBreak.to },
      match: (m) => m.from === centralBreak.from && m.to === centralBreak.to,
    });
  }

  // ---- Improve a piece ----------------------------------------------------
  if (f.phase !== "endgame" && (me.home.length >= 1 || (!me.castled && (me.canCastle.k || me.canCastle.q))) && f.phase === "opening") {
    const kingStep = !me.castled && (me.canCastle.k || me.canCastle.q);
    add({
      id: "develop",
      category: "improve",
      title: "Finish development",
      why: `${me.home.length ? `${cap(list(me.home.map((s) => pieceAt(f, s))))} ${me.home.length === 1 ? "is" : "are"} still at home` : "The king hasn't castled"}${me.home.length && kingStep ? " and the king hasn't castled" : ""}. Until that is done the rooks aren't connected and any fight starts a piece short.`,
      steps: [
        ...(me.home.length ? [step(`Bring out ${list(me.home.map((s) => pieceAt(f, s)))}${me.home.length > 1 ? ", each" : ""} to a square where it has a job.`, { squares: me.home.map((sq) => ({ sq, tone: "info" as const, style: "ring" as const })) })] : []),
        ...(kingStep ? [step(`Castle, and put the rooks on the files that are open or about to open.`)] : [step(`Connect the rooks and put them on the files that are open or about to open.`)]),
      ],
      weight: 30 + 6 * me.home.length + (kingStep ? 6 : 0),
      match: (m) => me.home.includes(m.from) || (m.piece === "k" && Math.abs(fileIndex(m.to) - fileIndex(m.from)) === 2),
    });
  }
  // A knight to an outpost or a hole.
  {
    const goals = ALL_SQUARES.filter((sq) => !f.p[sq] && fileIndex(sq) >= 1 && fileIndex(sq) <= 6 && (isOutpost(f.p, sq, c) || (them.holes.includes(sq) && attackersOf(f.p, sq, c).some((a) => f.p[a]!.type === "p"))));
    let best: { knight: Square; goal: Square; route: Square[] } | null = null;
    for (const goal of goals)
      for (const knight of me.knights) {
        if (isOutpost(f.p, knight, c) || knightDistance(knight, goal) > 3) continue;
        const route = knightRoute(f.p, knight, goal, c);
        if (!route) continue;
        const better = !best || route.length < best.route.length || (route.length === best.route.length && Math.abs(3.5 - fileIndex(goal)) < Math.abs(3.5 - fileIndex(best.goal)));
        if (better) best = { knight, goal, route };
      }
    if (best) {
      const { knight, goal, route } = best;
      const traders = attackersOf(f.p, goal, o).filter((s) => f.p[s]!.type === "n" || f.p[s]!.type === "b");
      const hits = attacksFrom(movePiece(f.p, knight, goal), goal).filter((s) => f.p[s]?.color === o && f.p[s]!.type !== "p" && f.p[s]!.type !== "k");
      // A long trip to a square the other side can simply trade on isn't a plan, least of all in the opening.
      if (route.length >= 3 && (f.phase === "opening" || traders.length)) best = null;
      if (best)
      add({
        id: `knight-${knight}-${goal}`,
        category: "improve",
        title: `Knight to ${goal}`,
        why: `The square ${goal} is an outpost: a pawn covers it and no ${N[o]} pawn can ever attack it. A knight there can't be driven away${hits.length ? ` and would hit ${list(hits.slice(0, 2).map((s) => pieceAt(f, s)))}` : ""}.`,
        steps: [step(`${cap(pieceAt(f, knight))} gets there in ${num(route.length)} move${route.length === 1 ? "" : "s"}: ${[knight, ...route].join(" → ")}.`, { arrows: routeArrows(knight, route), squares: [{ sq: goal, tone: "opportunity", style: "dashed" }] })],
        risk: traders.length ? `${N[o]} can trade it off when it lands, with ${pieceAt(f, traders[0])}. Removing that piece first makes the knight permanent.` : route.length > 1 ? `It takes ${num(route.length)} moves, so it is for a quiet moment.` : undefined,
        weight: 44 - 6 * (route.length - 1) + 3 * hits.length - (traders.length ? 6 : 0),
        key: { from: knight, to: route[0] },
        match: (m) => m.piece === "n" && m.from === knight && route.includes(m.to),
      });
    }
  }
  // The bad bishop.
  for (const sq of me.bishops) {
    const fixed = badBishop(f, sq);
    if (!fixed) continue;
    const colour = isLightSquare(sq) ? "light" : "dark";
    const counterpart = them.bishops.find((s) => isLightSquare(s) === isLightSquare(sq));
    add({
      id: `bad-bishop-${sq}`,
      category: counterpart ? "trade" : "improve",
      title: counterpart ? `Trade the ${colour}-squared bishops` : `Free the bishop on ${sq}`,
      why: `${N[c]}'s centre pawns on ${list(fixed)} are fixed on ${colour} squares, which leaves the bishop on ${sq} with nothing to look at.`,
      steps: [
        ...(counterpart ? [step(`Offer it for ${N[o]}'s bishop on ${counterpart}. Afterwards the pawns guard the ${colour} squares and ${N[c]}'s remaining pieces cover the others.`, { squares: [{ sq, tone: "danger", style: "ring" }, { sq: counterpart, tone: "info", style: "ring" }] })] : []),
        step(`Or get it in front of the pawns before closing the door behind it.`, { squares: fixed.map((s) => ({ sq: s, tone: "danger" as const, style: "ring" as const })) }),
      ],
      weight: 40,
      match: (m) => m.from === sq,
    });
  }
  // Rooks to an open file nobody holds yet.
  if (f.phase !== "opening" && me.rooks.length && f.openFiles.length <= 2) {
    const free = f.openFiles.filter((file) => ![...me.rooks, ...me.queens].some((s) => fileIndex(s) === file));
    const file = free.sort((a, b) => Math.abs(3.5 - a) - Math.abs(3.5 - b))[0];
    if (file != null) {
      const contested = [...them.rooks, ...them.queens].some((s) => fileIndex(s) === file);
      const rook = me.rooks.find((s) => attacksFrom(f.p, s).some((t) => fileIndex(t) === file && !f.p[t]));
      const to = rook ? attacksFrom(f.p, rook).find((t) => fileIndex(t) === file && !f.p[t] && rankIndex(t) === rankIndex(rook)) : undefined;
      add({
        id: `rook-file-${file}`,
        category: "improve",
        title: `A rook to the ${fileLetter(file)}-file`,
        why: `${f.openFiles.length === 1 ? "It is the only open file" : "It is an open file"}${contested ? `, and ${N[o]} already has a heavy piece on it` : ` and nobody holds it yet`}. Rooks do nothing behind their own pawns.`,
        steps: [
          step(contested ? `Oppose on the file, so ${N[o]} doesn't get it for free; be ready to double.` : `Take it first. If ${N[o]} opposes, double the rooks rather than trade.`, { bands: [{ kind: "file", index: file, tone: "opportunity" }], arrows: rook && to ? [{ from: rook, to, tone: "idea", dashed: true }] : [] }),
          step(`The point of the file is the square at the end of it: ${relSquare(file, 6, c)}, on the seventh rank.`, { squares: [{ sq: relSquare(file, 6, c)!, tone: "opportunity", style: "dashed" }] }),
        ],
        weight: 34 + (f.openFiles.length === 1 ? 8 : 0) + (endish ? 4 : 0),
        key: rook && to ? { from: rook, to } : undefined,
        match: (m) => m.piece === "r" && fileIndex(m.to) === file && fileIndex(m.from) !== file,
      });
    }
  }
  // The king, once it is safe to use it: towards the pawns, which is where an endgame is decided.
  if (f.phase === "endgame") {
    const all = [...me.pawns, ...them.pawns].map((x) => x.sq);
    if (all.length) {
      const file = Math.round(all.reduce((t, sq) => t + fileIndex(sq), 0) / all.length);
      const rank = Math.round(all.reduce((t, sq) => t + rankIndex(sq), 0) / all.length);
      const goal = toSquare(file, rank)!;
      const d = dist(me.king, goal);
      const where = all.every((sq) => fileIndex(sq) >= 4) ? "the kingside pawns" : all.every((sq) => fileIndex(sq) <= 3) ? "the queenside pawns" : "the centre";
      if (d >= 2) {
        add({
          id: "king-active",
          category: "improve",
          title: where === "the centre" ? "Bring the king to the centre" : `Bring the king up to ${where}`,
          why: `With so little left there is no attack to fear, and the king is a strong piece: next to the pawns it attacks the other side's and shields its own.`,
          steps: [step(`March it towards ${where}, about ${num(d)} move${d === 1 ? "" : "s"} away, before committing the pawns.`, { squares: [{ sq: me.king, tone: "opportunity", style: "ring" }], arrows: [{ from: me.king, to: goal, tone: "idea", dashed: true }] })],
          risk: me.rooks.length + them.rooks.length ? `With rooks on, watch for checks from the side: keep a pawn or a piece to hide behind.` : undefined,
          weight: 40 + (me.pieces === 0 ? 14 : 0),
          match: (m) => m.piece === "k" && dist(m.to, goal) < dist(m.from, goal),
        });
      }
    }
  }

  // ---- Trades -------------------------------------------------------------
  if (ahead) {
    add({
      id: "simplify",
      category: "trade",
      title: "Trade pieces, keep pawns",
      why: `${N[c]} is ${mw!.text}. Each pair of pieces that comes off makes the extra material a bigger share of what's left; the pawns are what it will win or escort later.`,
      steps: [step(`Offer trades of queens and minor pieces whenever it costs nothing.`), step(`Keep the pawns: a piece up with no pawns left is often a draw.`)],
      risk: `Don't trade into an ending where the extra piece has nothing to attack, and don't loosen your own king to force a swap.`,
      weight: 56,
      match: (m) => !!m.captured && m.piece !== "p" && m.piece !== "k" && (m.captured === m.piece || (isMinor(m.piece) && isMinor(m.captured))),
    });
  } else if (!behind && f.phase !== "endgame" && them.space - me.space >= 5 && me.pieces >= 20 && them.pieces >= 20 && !out.some((d) => d.id === "iqp-blockade")) {
    add({
      id: "trade-for-room",
      category: "trade",
      title: "Trade a pair of minor pieces",
      why: `${N[c]} has less space, and four minor pieces don't fit where three do. After one trade the rest find squares.`,
      steps: [step(`Offer a knight or bishop for its opposite number, ideally ${N[o]}'s most active one.`)],
      risk: `${N[o]} will avoid trades for the same reason. A pawn break achieves the same thing more forcefully.`,
      weight: 32,
      match: (m) => !!m.captured && (m.piece === "n" || m.piece === "b") && (m.captured === "n" || m.captured === "b"),
    });
  }
  // An enemy piece on an outpost: only a trade removes it.
  for (const sq of [...them.knights, ...them.bishops]) {
    if (!isOutpost(f.p, sq, o) || rel(sq, o) < 4) continue;
    const challengers = [...me.knights, ...me.bishops].filter((s) => attacksFrom(f.p, s).includes(sq) || (f.p[s]!.type === "b" && isLightSquare(s) === isLightSquare(sq)) || (f.p[s]!.type === "n" && knightDistance(s, sq) <= 2));
    if (!challengers.length) continue;
    add({
      id: `challenge-${sq}`,
      category: "trade",
      title: `Get rid of the ${PIECE_NAME[f.p[sq]!.type]} on ${sq}`,
      why: `It sits on an outpost and no pawn can chase it, so it stays until it is traded. Left alone it is the best piece on the board.`,
      steps: [step(`Aim ${pieceAt(f, challengers[0])} at it and offer the trade.`, { squares: [{ sq, tone: "danger", style: "ring" }], arrows: [{ from: challengers[0], to: sq, tone: "idea", dashed: true }] })],
      weight: 40,
      match: (m) => m.to === sq && !!m.captured,
    });
    break;
  }

  // ---- Go after a weakness ------------------------------------------------
  if (!iqp || iqp.side === c || endish) {
    const weak = weakPawns(f, o).sort((a, b) => Number(b.vulnerable) - Number(a.vulnerable) || Math.abs(3.5 - fileIndex(a.sq)) - Math.abs(3.5 - fileIndex(b.sq)))[0];
    if (weak) {
      const file = fileIndex(weak.sq);
      const front = relSquare(file, rel(weak.sq, o) + 1, o);
      const atk = attackersOf(f.p, weak.sq, c).length;
      const def = attackersOf(f.p, weak.sq, o).length;
      add({
        id: `target-${weak.sq}`,
        category: "target",
        title: `Lean on the ${weak.sq} pawn`,
        why: `It is ${weak.isolated ? "isolated" : "backward"} on a half-open file: no pawn can come to its help, so each attacker ${N[c]} adds has to be answered by a piece.`,
        steps: [
          ...(front ? [step(`Control ${front} first, so the pawn can't advance and trade itself off.`, { squares: [{ sq: front, tone: "opportunity", style: "dashed" }] })] : []),
          step(`Rooks to the ${fileLetter(file)}-file, then the minor pieces. Right now it is attacked ${times(atk)} and defended ${times(def)}.`, { bands: [{ kind: "file", index: file, tone: "opportunity" }], squares: [{ sq: weak.sq, tone: "danger", style: "ring" }] }),
          step(`When ${N[o]}'s pieces are tied to it, open a second front on the other side of the board: they can't be in both places.`),
        ],
        weight: 40 + (weak.vulnerable ? 6 : 0) + (endish ? 6 : 0),
        match: (m) => (m.piece === "r" && fileIndex(m.to) === file) || m.to === front || m.to === weak.sq,
      });
    }
  }

  // ---- Pawn play ----------------------------------------------------------
  const passer = me.pawns.filter((x) => x.passed).sort((a, b) => rel(b.sq, c) - rel(a.sq, c))[0];
  if (passer) {
    const file = fileIndex(passer.sq);
    const stop = relSquare(file, rel(passer.sq, c) + 1, c);
    if (stop) {
      const after = movePiece(f.p, passer.sq, stop);
      const mine = attackersOf(after, stop, c).length;
      const theirs = attackersOf(after, stop, o).length;
      const blocked = !!f.p[stop];
      add({
        id: `passer-${passer.sq}`,
        category: "pawns",
        title: `Advance the passed ${fileLetter(file)}-pawn`,
        why: `It is ${num(7 - rel(passer.sq, c))} square${7 - rel(passer.sq, c) === 1 ? "" : "s"} from queening and only pieces can stop it. Each step forward ties ${N[o]} down more.`,
        steps: [
          step(
            blocked ? (f.p[stop]!.color === c ? `Its own ${PIECE_NAME[f.p[stop]!.type]} stands in front of it on ${stop} for now; it advances once that piece has done its work there.` : `${cap(pieceAt(f, stop))} blocks it on ${stop}: drive the blocker off or trade it.`) : mine >= theirs ? `The next square, ${stop}, is covered ${num(mine)} time${mine === 1 ? "" : "s"} against ${num(theirs)}: it can advance.` : `Cover ${stop} first (${num(mine)} against ${num(theirs)} now), then push.`,
            { arrows: [{ from: passer.sq, to: stop, tone: "idea", dashed: true }], squares: [{ sq: stop, tone: blocked || mine < theirs ? "danger" : "opportunity", style: "dashed" }] },
          ),
          step(`Rooks belong behind it, and in an endgame the king walks in front.`),
        ],
        risk: `A passed pawn that runs ahead of its support gets rounded up. Advance it when the next square is safe, not before.`,
        weight: 34 + 7 * Math.max(0, rel(passer.sq, c) - 3) + (endish ? 12 : 0),
        key: !blocked ? { from: passer.sq, to: stop } : undefined,
        match: (m) => m.from === passer.sq,
      });
    }
  } else if (endish) {
    const wing = (["queenside", "kingside"] as Wing[]).find((w) => me.wingPawns[w] > them.wingPawns[w] && me.wingPawns[w] >= 2);
    if (wing) {
      const files = wing === "queenside" ? [0, 1, 2] : [5, 6, 7];
      const candidate = me.pawns.filter((x) => files.includes(fileIndex(x.sq)) && !fileState(f.p, fileIndex(x.sq))[o]).sort((a, b) => rel(b.sq, c) - rel(a.sq, c))[0];
      add({
        id: `majority-${wing}`,
        category: "pawns",
        title: `Make a passed pawn on the ${wing}`,
        why: `${cap(num(me.wingPawns[wing]))} pawns against ${num(them.wingPawns[wing])} there. Pushed in the right order, one of them gets through.`,
        steps: [
          step(candidate ? `Lead with the ${fileLetter(fileIndex(candidate.sq))}-pawn, the one with no ${N[o]} pawn in front of it; the others follow to support it.` : `Advance them together so that none is left behind as a target.`, {
            squares: me.pawns.filter((x) => files.includes(fileIndex(x.sq))).map((x) => ({ sq: x.sq, tone: "opportunity" as const, style: "ring" as const })),
          }),
        ],
        risk: wingOfFile(fileIndex(me.king)) === wing ? `These pawns also shelter the king. With heavy pieces still on, advance them only as far as the king can afford.` : undefined,
        weight: 36,
        key: candidate && relSquare(fileIndex(candidate.sq), rel(candidate.sq, c) + 1, c) && !f.p[relSquare(fileIndex(candidate.sq), rel(candidate.sq, c) + 1, c)!] ? { from: candidate.sq, to: relSquare(fileIndex(candidate.sq), rel(candidate.sq, c) + 1, c)! } : undefined,
        match: pawnOn(files),
      });
    }
  }

  const legalFor = c === f.turn ? f.ctx.legal : [];
  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map((d): StrategicPlan => {
      const legal = d.key ? legalFor.find((m) => m.from === d.key!.from && m.to === d.key!.to) : undefined;
      return { ...d, side: c, marks: marks(d.marks ?? mergeSteps(d.steps)), keyUci: legal ? legal.lan : d.key ? `${d.key.from}${d.key.to}` : undefined, keySan: legal?.san };
    });
}

function mergeSteps(steps: PlanStep[]): Partial<Marks> {
  const m = emptyMarks();
  for (const s of steps.slice(0, 2)) {
    m.squares.push(...s.marks.squares);
    m.arrows.push(...s.marks.arrows);
    m.bands!.push(...(s.marks.bands ?? []));
  }
  return m;
}

/** Marks which plans the engine's lines actually play, and puts those first. */
export function withEngine(f: Features, plans: StrategicPlan[], engine: EngineRead | undefined): StrategicPlan[] {
  if (!engine?.lines.length) return plans;
  const vars = engine.lines.slice(0, 3).map((l) => buildVariation(f.fen, l.pv, 8));
  const scored = plans.map((p) => {
    if (!p.match) return { ...p, engine: { follows: "none" as const } };
    for (let i = 0; i < vars.length; i++) {
      // The main line counts for its first three moves by this side; another line only if it starts with the plan.
      const own = vars[i].moves.map((m, idx) => ({ m, idx })).filter((x) => x.m.color === p.side);
      const hit = own.slice(0, i === 0 ? 3 : 1).find((x) => p.match!(x.m));
      if (!hit || (i > 0 && p.side !== f.turn)) continue;
      const nth = own.indexOf(hit) + 1;
      const when = hit.idx === 0 ? "starts with it" : nth === 1 ? "answers with it" : `gets to it on its ${nth === 2 ? "second" : "third"} move`;
      return {
        ...p,
        engine: {
          follows: i === 0 ? ("main" as const) : ("other" as const),
          note: `${i === 0 ? "The engine's main line" : `The engine's ${i === 1 ? "second" : "third"} choice`} ${when}: ${moveLabel(hit.m)}.`,
          line: { fen: f.fen, pv: vars[i].moves.slice(0, hit.idx + 1).map((x) => x.uci), label: moveLabel(hit.m) },
        },
      };
    }
    return { ...p, engine: { follows: "none" as const } };
  });
  const rank = (p: StrategicPlan) => p.weight + (p.engine?.follows === "main" ? 24 : p.engine?.follows === "other" ? 10 : 0);
  return scored.sort((a, b) => rank(b) - rank(a));
}

export const categoryOrder: PlanCategory[] = ["defend", "attack", "centre", "wing", "target", "improve", "trade", "pawns"];
