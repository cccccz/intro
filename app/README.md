# app/

真实现只放这里。`mockup/` 仍是演示，不共用入口。本轮是 P1：标记代数和磁盘上的库，没有 Electron / 编辑器 UI。

## 标记

语法草案：[marks/SYNTAX.md](marks/SYNTAX.md)

库入口：`app/marks/`（`parse` → 钉树，`strip`，交叉当损坏，`add` / `addMark`）。

```ts
import { add, parse, strip } from "./marks/index.ts";

const clean = "宿主正文";
const marked = add(clean, [{ id: "r1", to: "side01", start: 0, end: 2 }]);
strip(marked) === clean; // inverse
parse(marked).rivets;    // 嵌套树；damage 非空即损坏
```

## 库（一篇一个文件）

一篇 = 库目录下任意一层的 `{id}.intro.md`。id 即文件名主干；`to` 写篇 id，不写路径。

```ts
import { Library } from "./library/index.ts";

const lib = new Library("/path/to/library");
lib.createPiece({ id: "host01", body: marked });
lib.save("host01", marked);
lib.load("host01");
lib.resolve("host01"); // → 绝对路径
```

没有搜索、没有导出。

## 测试

在仓库根目录：

```
npm test
```

用 Node 内置 `node:test`，不经过 mockup 的 `tsc`。类型检查：`npm run typecheck:app`。
