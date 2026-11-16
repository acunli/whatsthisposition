/**
 * The mistakes of a set of games, added up into weaknesses: what the player gets wrong most,
 * how much it costs, when it happens, and the puzzles that train it. The training order
 * leads with the costliest weakness and takes turns between them.
 */
import type { GamePhase, Motif, Puzzle, PuzzleSet, Slip, Way, Weakness } from "./types";

/** At most this many puzzles in a set: enough for a session, few enough to finish. */
export const MAX_PUZZLES = 36;

const NAMES: Record<string, { name: string; text: (n: string) => string; advice: string }> = {
  "allowed:mate": {
    name: "Walking into mate",
    text: (n) => `${n} your move allowed a forced mate.`,
    advice: "Before every move, look at the checks the other side will have after it, starting with the ones near your king.",
  },
  "missed:mate": {
    name: "Missed checkmates",
    text: (n) => `${n} there was a forced mate on the board and the game went another way.`,
    advice: "When the enemy king is short of squares, look at every check first, even the ones that give something up.",
  },
  "allowed:hanging": {
    name: "Pieces left hanging",
    text: (n) => `${n} a piece was left, or put, where it could simply be taken.`,
    advice: "After choosing a move, check the square the piece lands on and what it stopped defending: is anything attacked more often than it is guarded?",
  },
  "missed:hanging": {
    name: "Free pieces not taken",
    text: (n) => `${n} the opponent left a piece loose and it wasn't taken.`,
    advice: "After each of the opponent's moves, ask what it stopped defending. Undefended pieces are where tactics start.",
  },
  "allowed:fork": { name: "Forks walked into", text: (n) => `${n} your move let one enemy piece attack two things at once.`, advice: "Watch the squares a knight or pawn could jump to with check or with an attack on your queen: pieces on the same colour and a knight's move apart are a fork waiting." },
  "missed:fork": { name: "Forks you missed", text: (n) => `${n} one move would have attacked two things at once, and wasn't played.`, advice: "Look for two enemy pieces, or a piece and the king, that one of your pieces could hit together, especially with a check." },
  "allowed:pin": { name: "Pins walked into", text: (n) => `${n} your move let a piece be pinned to something more valuable behind it.`, advice: "Notice when two of your pieces stand on one line with nothing between them and the enemy's bishops, rooks or queen." },
  "missed:pin": { name: "Pins you missed", text: (n) => `${n} a pin would have won material, and wasn't played.`, advice: "When an enemy piece stands in front of its king or queen on an open line, ask what happens if you attack it again." },
  "allowed:skewer": { name: "Skewers walked into", text: (n) => `${n} your move lined up two pieces for an attack through the first onto the second.`, advice: "Keep the king and queen off the same open line as each other and as your rooks." },
  "missed:skewer": { name: "Skewers you missed", text: (n) => `${n} an attack through one piece onto another behind it was available, and wasn't played.`, advice: "A check on an open line is worth a second look: what stands behind the king when it steps aside?" },
  "allowed:defender": { name: "Defenders given up", text: (n) => `${n} the opponent could remove a piece that was holding your position together.`, advice: "Count what each of your pieces is defending. A piece with two jobs is a target." },
  "missed:defender": { name: "Removing the defender", text: (n) => `${n} taking or chasing away a defender would have won something behind it.`, advice: "When a piece you want is defended once, look at the defender, not the piece." },
  "allowed:promotion": { name: "Pawns let through", text: (n) => `${n} your move let a pawn run to promotion.`, advice: "A passed pawn two squares from queening comes before everything else: count who gets there first." },
  "missed:promotion": { name: "Promotions you missed", text: (n) => `${n} a pawn could have gone through to queen, and didn't.`, advice: "With a far-advanced pawn, look at the push first, including the one that gives something up to clear the way." },
  "allowed:tactic": { name: "Tactics you allowed", text: (n) => `${n} your move let the opponent win material by force.`, advice: "Before letting go of the piece, look at the opponent's checks, captures and threats in that order." },
  "missed:tactic": { name: "Tactics you missed", text: (n) => `${n} a forcing line would have won material, and wasn't played.`, advice: "When your pieces are active and something of theirs is loose, stop and look at every check and capture before the natural move." },
  "slip:win": { name: "Winning positions let slip", text: (n) => `${n} you were winning and one move let most of it go, without losing anything on the spot.`, advice: "When ahead, the opponent's counterplay is the only thing that matters: find their best idea first, stop it, then go on." },
  "slip:opening": { name: "Slips in the opening", text: (n) => `${n} an early move gave up ground: time, the centre, or the king's safety.`, advice: "In the first dozen moves, a piece developed or the king castled is almost never the mistake. A second move with the same piece often is." },
  "slip:endgame": { name: "Endgame technique", text: (n) => `${n} an endgame move let the advantage shrink or the position worsen.`, advice: "In an endgame, the king goes towards the pawns and rooks go behind passed pawns. Count before pushing a pawn: it can't come back." },
  "slip:positional": { name: "Quiet mistakes", text: (n) => `${n} a move lost ground without any tactic: a worse square, a wrong trade, a weakening pawn move.`, advice: "When nothing is attacked, find the piece doing the least and improve it, and think twice about pawn moves in front of your king." },
};

const times = (n: number) => (n === 1 ? "Once," : n === 2 ? "Twice," : `${["Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n - 3] ?? n} times,`);

export function weaknessName(key: string): string {
  return NAMES[key]?.name ?? "Other mistakes";
}

/** The slips grouped into weaknesses, costliest first. */
export function weaknesses(slips: Slip[]): Weakness[] {
  const by = new Map<string, Slip[]>();
  for (const s of slips) by.set(s.key, [...(by.get(s.key) ?? []), s]);
  const out: Weakness[] = [];
  for (const [key, list] of by) {
    const [way, motif] = key.split(":") as [Way, Motif];
    const info = NAMES[key];
    const phases: Record<GamePhase, number> = { opening: 0, middlegame: 0, endgame: 0 };
    for (const s of list) phases[s.phase]++;
    const top = (Object.entries(phases) as [GamePhase, number][]).sort((a, b) => b[1] - a[1])[0];
    const games = new Set(list.map((s) => s.game)).size;
    const rushed = list.filter((s) => s.rushed).length;
    const where = list.length >= 3 && top[1] / list.length >= 0.6 && !/opening|endgame/.test(motif) ? ` Mostly in the ${top[0]}.` : "";
    const clock = rushed >= 2 && rushed / list.length >= 0.5 ? ` ${rushed === list.length ? "Every time" : `${rushed} of those`} with less than half a minute on the clock.` : "";
    out.push({
      key,
      way,
      motif,
      name: info?.name ?? "Other mistakes",
      text: `${info ? info.text(times(list.length)) : `${times(list.length)} a move lost ground.`}${where}${clock}`,
      advice: info?.advice ?? "",
      count: list.length,
      games,
      loss: list.reduce((t, s) => t + s.loss, 0),
      phases,
      rushed,
      puzzles: list.flatMap((s) => (s.puzzle ? [s.puzzle] : [])),
    });
  }
  return out.sort((a, b) => b.loss - a.loss || b.count - a.count);
}

/** The puzzles in training order: the costliest weakness first, then taking turns, each weakness's biggest mistakes first. */
export function trainingOrder(puzzles: Puzzle[], ranked: Weakness[], max = MAX_PUZZLES): Puzzle[] {
  const queues = ranked.map((w) => puzzles.filter((p) => p.key === w.key).sort((a, b) => b.loss - a.loss));
  const out: Puzzle[] = [];
  for (let round = 0; out.length < max && queues.some((q) => q.length > round); round++) for (const q of queues) if (q[round] && out.length < max) out.push(q[round]);
  return out;
}

/** A set from everything the games gave. */
export function makeSet(parts: { slips: Slip[]; puzzles: Puzzle[]; moves: number }[], player: string | undefined, now: number): PuzzleSet {
  const slips = parts.flatMap((p) => p.slips);
  const all = parts.flatMap((p) => p.puzzles).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
  const ranked = weaknesses(slips);
  const puzzles = trainingOrder(all, ranked);
  const kept = new Set(puzzles.map((p) => p.id));
  return {
    v: 1,
    made: now,
    ...(player ? { player } : {}),
    games: parts.length,
    moves: parts.reduce((t, p) => t + p.moves, 0),
    slips: slips.map((s) => (s.puzzle && !kept.has(s.puzzle) ? { ...s, puzzle: undefined } : s)),
    weaknesses: ranked.map((w) => ({ ...w, puzzles: w.puzzles.filter((id) => kept.has(id)) })),
    puzzles,
  };
}
