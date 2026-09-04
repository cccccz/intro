import {
  CLOSE_START,
  MAX_TAG_LEN,
  OPEN_START,
  TAG_END,
  parseAttrs,
} from "./syntax.ts";

export type TextTok = { kind: "text"; value: string; index: number };

export type OpenTok = {
  kind: "open";
  id: string | null;
  to: string | null;
  raw: string;
  index: number;
  malformed: boolean;
};

export type CloseTok = {
  kind: "close";
  id: string | null;
  raw: string;
  index: number;
  malformed: boolean;
};

export type Token = TextTok | OpenTok | CloseTok;

function tryTag(
  body: string,
  i: number,
): { token: OpenTok | CloseTok; end: number } | null {
  const isClose = body.startsWith(CLOSE_START, i);
  const isOpen = !isClose && body.startsWith(OPEN_START, i);
  if (!isClose && !isOpen) {
    return null;
  }
  const prefix = isClose ? CLOSE_START : OPEN_START;
  const newline = body.indexOf("\n", i);
  const limit = Math.min(
    body.length,
    i + MAX_TAG_LEN,
    newline === -1 ? body.length : newline,
  );
  const endAt = body.indexOf(TAG_END, i + prefix.length);
  if (endAt === -1 || endAt + TAG_END.length > limit) {
    return null;
  }
  const raw = body.slice(i, endAt + TAG_END.length);
  const inner = body.slice(i + prefix.length, endAt);
  const attrs = parseAttrs(inner);
  if (attrs === null) {
    return {
      token: isClose
        ? { kind: "close", id: null, raw, index: i, malformed: true }
        : {
            kind: "open",
            id: null,
            to: null,
            raw,
            index: i,
            malformed: true,
          },
      end: endAt + TAG_END.length,
    };
  }
  const id = attrs.id && attrs.id.length > 0 ? attrs.id : null;
  if (isClose) {
    return {
      token: { kind: "close", id, raw, index: i, malformed: false },
      end: endAt + TAG_END.length,
    };
  }
  const to = attrs.to && attrs.to.length > 0 ? attrs.to : null;
  return {
    token: { kind: "open", id, to, raw, index: i, malformed: false },
    end: endAt + TAG_END.length,
  };
}

export function scan(body: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let textStart = 0;
  while (i < body.length) {
    const tag = tryTag(body, i);
    if (tag) {
      if (i > textStart) {
        tokens.push({
          kind: "text",
          value: body.slice(textStart, i),
          index: textStart,
        });
      }
      tokens.push(tag.token);
      i = tag.end;
      textStart = i;
      continue;
    }
    i += 1;
  }
  if (textStart < body.length) {
    tokens.push({
      kind: "text",
      value: body.slice(textStart),
      index: textStart,
    });
  }
  return tokens;
}
