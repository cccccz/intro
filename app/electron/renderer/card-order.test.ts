import assert from "node:assert/strict";
import test from "node:test";
import { orderCards } from "./card-order.ts";

test("repeated chrome refreshes do not reinsert already sorted side cards", () => {
  const cards = [{ id: "a" }, { id: "b" }];
  const stack = {
    children: [...cards],
    moveBefore() { assert.fail("unchanged cards must remain attached"); },
  };
  for (let frame = 0; frame < 10; frame += 1) orderCards(stack, cards);
});

test("changed order uses only necessary atomic moves", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];
  let moves = 0;
  const stack = {
    children: [...cards],
    moveBefore(card: typeof cards[number], before: typeof cards[number] | null) {
      moves += 1;
      this.children.splice(this.children.indexOf(card), 1);
      this.children.splice(before === null ? this.children.length : this.children.indexOf(before), 0, card);
    },
  };
  orderCards(stack, [cards[2], cards[0], cards[1]]);
  assert.deepEqual(stack.children, [cards[2], cards[0], cards[1]]);
  assert.equal(moves, 1);
});
