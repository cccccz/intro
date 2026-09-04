const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Piece / rivet id: ULID when generated; tests may use shorter tokens. */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isPieceId(id: string): boolean {
  return ID_RE.test(id);
}

export function ulid(now = Date.now()): string {
  if (!Number.isFinite(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError("time out of ULID range");
  }
  const chars = new Array<string>(26);
  let time = Math.floor(now);
  for (let i = 9; i >= 0; i--) {
    chars[i] = CROCKFORD[time & 31];
    time = Math.floor(time / 32);
  }
  const rnd = new Uint8Array(10);
  crypto.getRandomValues(rnd);
  let buffer = 0n;
  for (const byte of rnd) {
    buffer = (buffer << 8n) | BigInt(byte);
  }
  for (let i = 25; i >= 10; i--) {
    chars[i] = CROCKFORD[Number(buffer & 31n)];
    buffer >>= 5n;
  }
  return chars.join("");
}
