export type DamageKind =
  | "crossing"
  | "unclosed"
  | "orphan-close"
  | "duplicate-id"
  | "missing-id"
  | "malformed"
  | "invalid-id"
  | "invalid-range";

export type Damage = {
  kind: DamageKind;
  message: string;
  /** UTF-16 index in the marked body (or 0 for spec errors). Diagnostic only. */
  index: number;
  id?: string;
};

export type Rivet = {
  id: string;
  to: string | null;
  children: Rivet[];
  /** [start, end) in strip(body). Derived; not stored authority. */
  cleanStart: number;
  cleanEnd: number;
};

export type ParseResult = {
  rivets: Rivet[];
  damage: Damage[];
};

export type RivetSpec = {
  id: string;
  to?: string | null;
  /** [start, end) in clean (stripped) text, UTF-16 code units. */
  start: number;
  end: number;
};
