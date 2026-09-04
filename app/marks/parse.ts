import { isPieceId } from "./id.ts";
import { scan } from "./scan.ts";
import type { Damage, ParseResult, Rivet } from "./types.ts";

type Frame = {
  id: string;
  to: string | null;
  children: Rivet[];
  cleanStart: number;
  openIndex: number;
};

export function isDamaged(result: ParseResult): boolean {
  return result.damage.length > 0;
}

export function parse(body: string): ParseResult {
  const tokens = scan(body);
  const roots: Rivet[] = [];
  const stack: Frame[] = [];
  const seen = new Set<string>();
  const damage: Damage[] = [];
  let clean = 0;

  const pushDamage = (
    kind: Damage["kind"],
    message: string,
    index: number,
    id?: string,
  ): void => {
    damage.push(id === undefined ? { kind, message, index } : { kind, message, index, id });
  };

  for (const tok of tokens) {
    if (tok.kind === "text") {
      clean += tok.value.length;
      continue;
    }

    if (tok.malformed) {
      pushDamage("malformed", `malformed rivet tag: ${tok.raw}`, tok.index);
      continue;
    }

    if (!tok.id) {
      pushDamage("missing-id", "rivet tag is missing id", tok.index);
      continue;
    }

    if (!isPieceId(tok.id)) {
      pushDamage("invalid-id", `invalid rivet id: ${tok.id}`, tok.index, tok.id);
      continue;
    }

    if (tok.kind === "open") {
      if (seen.has(tok.id)) {
        pushDamage(
          "duplicate-id",
          `duplicate rivet id: ${tok.id}`,
          tok.index,
          tok.id,
        );
        continue;
      }
      seen.add(tok.id);
      stack.push({
        id: tok.id,
        to: tok.to,
        children: [],
        cleanStart: clean,
        openIndex: tok.index,
      });
      continue;
    }

    if (stack.length === 0) {
      pushDamage(
        "orphan-close",
        `close ${tok.id} with empty stack`,
        tok.index,
        tok.id,
      );
      continue;
    }

    const top = stack[stack.length - 1];
    if (top.id !== tok.id) {
      const onStack = stack.some((frame) => frame.id === tok.id);
      pushDamage(
        onStack ? "crossing" : "orphan-close",
        onStack
          ? `close ${tok.id} while ${top.id} is still open (crossing)`
          : `close ${tok.id} does not match any open rivet`,
        tok.index,
        tok.id,
      );
      continue;
    }

    stack.pop();
    const node: Rivet = {
      id: top.id,
      to: top.to,
      children: top.children,
      cleanStart: top.cleanStart,
      cleanEnd: clean,
    };
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const frame of stack) {
    pushDamage(
      "unclosed",
      `rivet ${frame.id} was never closed`,
      frame.openIndex,
      frame.id,
    );
  }

  return { rivets: roots, damage };
}
