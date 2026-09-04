# app/

真实现只放这里。`mockup/` 仍是演示，不共用入口。

本轮是 **P2：M1 写回路**。标记与库仍是 P1 API；Electron 壳只调用它们。

## 怎么跑

在仓库根目录：

```
npm install
npm test
npm run app
```

开发时也可以 `npm run electron:dev`（同样是编译再开 Electron）。

可选：直接打开一个库目录（空目录也行，会当成新库）：

```
npm run app -- --library /path/to/library
```

`npm run build:app` 只编译到 `app/dist/`。`npm run typecheck:app` 做类型检查。

## M1 写回路（空库 → 嵌套铆点树）

1. **Open library**：选一个本地文件夹。空文件夹就是新库。
2. **New piece**：建第一篇 `{id}.intro.md`，出现在最左列。
3. 每列/每张卡片可切 **Source** 和 **Rendered**。Source 是这篇的权威面（做法 A：铆点标记在 `{id}.intro.md`）。屏幕上编辑的是清除后的干净正文（`$...$` 仍是源文）；`persistClean` / `addMark` 只走 Source，落盘仍带标记。Rendered 是同一篇的只读投影（Markdown + KaTeX），不是第二份正文。高亮与导线是视图像，不写入源文。
4. **划选一段**，点 **New side**：用 `addMark` 往宿主写入 `<<r id="…" to="…">>…<</r id="…">>`，并新建一篇侧边，作为下一列打开。视图像标出该选区，并有导线连到打开的侧边卡片（几何不落盘）。Rendered 里点 New side 会回到 Source 再划。
5. 在侧边里再划、再挂（d2）。列 = 深度；同一宿主上多个打开的铆点叠在该层 panel 里（多张卡片），不互相顶掉。高亮与导线随滚动/窗口缩放更新。源高亮滚出该列视口则不画对应侧边（不是合上）。
6. **Hang existing…** 把选区挂到库里已有的一篇（复用）。点铆点条目则打开已挂的侧边；已打开的再点一次只对准该卡片。
7. **Close** 只从画面拿掉该卡片及其子树；磁盘上的铆点和篇还在。合上宿主列则收起整条链。

三种看法、置顶带、导出、PDF 都不在本轮。

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

偏移是 **strip 之后正文** 的 UTF-16 下标。编辑器划选按干净正文算，再交给 `addMark`。

## 库（一篇一个文件）

一篇 = 库目录下任意一层的 `{id}.intro.md`。id 即文件名主干；`to` 写篇 id，不写路径。

```ts
import { Library } from "./library/index.ts";

const lib = new Library("/path/to/library");
lib.createPiece({ id: "host01", body: marked });
lib.save("host01", marked);
lib.load("host01");
lib.resolve("host01"); // → 绝对路径
lib.list();            // id + 路径，不读正文
```

写回路（无 UI）：`app/write/` 的 `persistClean` / `hangSide` / 列会话。Electron 主进程走同一套。

没有搜索、没有导出。屏幕可以显示 `strip` 后的宿主；磁盘仍留带标记的正文。

改过已有铆点的正文时：仍落在干净区间内的钉会留下来；对不上的钉会丢掉，避免写坏交叉。这是 M1 的折中，不是新权威。

## 测试

在仓库根目录：

```
npm test
```

用 Node 内置 `node:test`，不经过 mockup 的 `tsc`，也不跑 Electron E2E。类型检查：`npm run typecheck:app`。
