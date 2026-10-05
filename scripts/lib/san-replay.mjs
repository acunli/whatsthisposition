/**
 * A small, fast SAN replayer for building the opening book: about 50 times quicker
 * than chess.js because it only resolves which piece moves (it trusts the game to be
 * legal, except for the pin check that disambiguation needs). Checked against
 * chess.js by scripts/build-book.mjs --check.
 *
 * Squares are 0..63 with a1 = 0, h8 = 63. Pieces: 1..6 = P N B R Q K for White, negative for Black.
 */
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const LETTER = { N, B, R, Q, K };
const FEN_CHAR = ["", "P", "N", "B", "R", "Q", "K"];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PROMO = { "": 0, N: 1, B: 2, R: 3, Q: 4 };

export class Replay {
  constructor() {
    this.b = new Int8Array(64);
    const back = [R, N, B, Q, K, B, N, R];
    for (let f = 0; f < 8; f++) {
      this.b[f] = back[f];
      this.b[8 + f] = P;
      this.b[48 + f] = -P;
      this.b[56 + f] = -back[f];
    }
    this.turn = 1;
  }

  /** "placement w|b", as chess.js prints the first two FEN fields. */
  key() {
    let s = "";
    for (let r = 7; r >= 0; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.b[r * 8 + f];
        if (!p) e++;
        else {
          if (e) s += e;
          e = 0;
          s += p > 0 ? FEN_CHAR[p] : FEN_CHAR[-p].toLowerCase();
        }
      }
      if (e) s += e;
      if (r) s += "/";
    }
    return s + (this.turn > 0 ? " w" : " b");
  }

  /** Is square `sq` attacked by side `by` (1 or -1)? */
  attacked(sq, by) {
    const b = this.b;
    const f0 = sq & 7, r0 = sq >> 3;
    const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? b[r * 8 + f] : 0);
    const pr = r0 - by; // an attacking pawn stands one rank behind, from its side
    if (at(f0 - 1, pr) === by * P || at(f0 + 1, pr) === by * P) return true;
    for (const [df, dr] of KNIGHT) if (at(f0 + df, r0 + dr) === by * N) return true;
    for (const [df, dr] of KING) if (at(f0 + df, r0 + dr) === by * K) return true;
    for (const [dirs, a, c] of [[DIAG, B, Q], [ORTHO, R, Q]])
      for (const [df, dr] of dirs)
        for (let f = f0 + df, r = r0 + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) {
          const p = b[r * 8 + f];
          if (!p) continue;
          if (p === by * a || p === by * c) return true;
          break;
        }
    return false;
  }

  /** Can the piece on `from` (type t > 1) move like itself to `to`, given blockers? */
  reaches(from, to, t) {
    const df = (to & 7) - (from & 7), dr = (to >> 3) - (from >> 3);
    const adf = Math.abs(df), adr = Math.abs(dr);
    if (t === N) return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    if (t === K) return adf <= 1 && adr <= 1;
    const straight = df === 0 || dr === 0;
    const diag = adf === adr;
    if ((t === B && !diag) || (t === R && !straight) || (t === Q && !straight && !diag)) return false;
    const sf = Math.sign(df), sr = Math.sign(dr);
    for (let f = (from & 7) + sf, r = (from >> 3) + sr; f !== (to & 7) || r !== to >> 3; f += sf, r += sr) if (this.b[r * 8 + f]) return false;
    return true;
  }

  /** Would moving from → to leave the mover's king in check? */
  leavesCheck(from, to, epVictim = -1) {
    const b = this.b;
    const moved = b[from], cap = b[to];
    const epPiece = epVictim >= 0 ? b[epVictim] : 0;
    b[to] = moved;
    b[from] = 0;
    if (epVictim >= 0) b[epVictim] = 0;
    const king = b.indexOf(this.turn * K);
    const bad = king >= 0 && this.attacked(king, -this.turn);
    b[from] = moved;
    b[to] = cap;
    if (epVictim >= 0) b[epVictim] = epPiece;
    return bad;
  }

  /** A copy, to branch from. */
  clone() {
    const r = Object.create(Replay.prototype);
    r.b = this.b.slice();
    r.turn = this.turn;
    return r;
  }

  /** Plays a move given as squares (as the book stores it): castling, en passant and promotion included. */
  play(from, to, promo = 0) {
    const b = this.b;
    const p = b[from];
    const t = Math.abs(p);
    if (t === K && Math.abs(to - from) === 2) {
      const long = to < from;
      const rf = long ? from - 4 : from + 3;
      b[long ? from - 1 : from + 1] = b[rf];
      b[rf] = 0;
    }
    if (t === P && (to & 7) !== (from & 7) && !b[to]) b[to - 8 * Math.sign(p)] = 0;
    b[to] = promo ? Math.sign(p) * [0, N, B, R, Q][promo] : p;
    b[from] = 0;
    this.turn = -this.turn;
  }

  /**
   * Plays one SAN move. Returns {from, to, promo} (promo 0..4 = none, n, b, r, q), or
   * null if the move can't be resolved (then the game should stop there).
   */
  move(san) {
    const b = this.b;
    const me = this.turn;
    let s = san.replace(/[+#]+$/, "");
    if (s === "O-O" || s === "0-0" || s === "O-O-O" || s === "0-0-0") {
      const rank = me > 0 ? 0 : 56;
      const long = s.length > 3;
      const from = rank + 4, to = rank + (long ? 2 : 6);
      const rf = rank + (long ? 0 : 7), rt = rank + (long ? 3 : 5);
      if (b[from] !== me * K || b[rf] !== me * R) return null;
      b[to] = b[from];
      b[from] = 0;
      b[rt] = b[rf];
      b[rf] = 0;
      this.turn = -me;
      return { from, to, promo: 0 };
    }
    let promo = 0;
    const pm = s.match(/=?([NBRQ])$/);
    if (pm && /[1-8]=?[NBRQ]$/.test(s)) {
      promo = PROMO[pm[1]];
      s = s.slice(0, s.length - pm[0].length);
    }
    const m = s.match(/^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])$/);
    if (!m) return null;
    const to = (m[4].charCodeAt(0) - 97) + 8 * (Number(m[4][1]) - 1);
    const dFile = m[2] ? m[2].charCodeAt(0) - 97 : -1;
    const dRank = m[3] ? Number(m[3]) - 1 : -1;
    const target = b[to];
    if (target && Math.sign(target) === me) return null;

    if (!m[1]) {
      // Pawn move.
      let from = -1;
      let ep = -1;
      if (dFile >= 0 && dFile !== (to & 7)) {
        from = to - 8 * me + (dFile - (to & 7));
        if (b[from] !== me * P) return null;
        if (!target) {
          ep = to - 8 * me;
          if (b[ep] !== -me * P) return null;
        }
      } else {
        if (target) return null;
        const one = to - 8 * me;
        if (b[one] === me * P) from = one;
        else if (!b[one] && b[one - 8 * me] === me * P && (to >> 3) === (me > 0 ? 3 : 4)) from = one - 8 * me;
        else return null;
      }
      const lastRank = me > 0 ? 7 : 0;
      if (((to >> 3) === lastRank) !== (promo > 0)) return null;
      b[to] = promo ? me * [0, N, B, R, Q][promo] : me * P;
      b[from] = 0;
      if (ep >= 0) b[ep] = 0;
      this.turn = -me;
      return { from, to, promo };
    }

    const t = LETTER[m[1]];
    const cands = [];
    for (let sq = 0; sq < 64; sq++) {
      if (b[sq] !== me * t) continue;
      if (dFile >= 0 && (sq & 7) !== dFile) continue;
      if (dRank >= 0 && sq >> 3 !== dRank) continue;
      if (this.reaches(sq, to, t)) cands.push(sq);
    }
    let from = cands[0];
    if (cands.length > 1) {
      const legal = cands.filter((sq) => !this.leavesCheck(sq, to));
      if (legal.length !== 1) return null;
      from = legal[0];
    }
    if (from === undefined) return null;
    b[to] = b[from];
    b[from] = 0;
    this.turn = -me;
    return { from, to, promo: 0 };
  }
}
