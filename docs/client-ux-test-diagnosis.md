# 客户端体验测试诊断

读者：产品 owner。读完应能直接选 P0 / P1 / P2，不必再翻仓库。

范围：只诊断测试能力与缺口，**不改产品功能代码**。对照提交 `1b52a89`（`origin/main`）。命令于 2026-09-16 在 Linux、Node v22.14.0、npm 10.9.7 上重跑。

结论先说：

1. 现有 `npm test` 对**标记、库、写回、PDF 侧车、渲染纯函数、AI 提交**是够的（137 项，全过）。
2. 对**窗口里的体验**几乎为零。这不是疏忽，是 `ENGINEERING.md` 写明的政策：「不做 UI snapshot，也不做 Electron E2E。」
3. 体验问题更可能来自 **缺测试类型 + 没有真实 Electron/UI 跑法**（并列主因），其次是 **UI 邻接断言太浅** 和 **缺门禁**。不能用「测试已经够、只剩产品债」解释——产品壳确实难测，但默认套件连空态文案、拖分割条、PDF 框选都跑不到。

---

## 1. 现有测试怎么跑

根目录 `package.json` scripts（当前实值）：

```
mockup          tsc -p mockup/tsconfig.json
test            node --experimental-strip-types --test <20 个显式文件>
typecheck:app   tsc -p app/tsconfig.json && tsc -p app/electron/renderer/tsconfig.json --noEmit
build:app       编译到 app/dist/ 并 copy-static
app             build:app && electron .
codex:check     build:app && node app/ai/doctor.mjs
electron:dev    同 app
```

没有 `test:ui`、`test:e2e`、`test:electron`。`npm test` **按文件名单跑**，不自动发现新 `*.test.*`。

框架：Node 内置 `node:test` + `node:assert/strict`。无 Jest / Vitest / Playwright / Cypress / jsdom。devDependencies 只有 `@types/node`、`electron`、`typescript`。

本次实跑：

```
$ npm test
# tests 137
# suites 30
# pass 137
# fail 0
# duration_ms 842.196879
```

```
$ npm run typecheck:app
# 退出码 0，无输出
```

GitHub Actions：`gh api repos/cccccz/intro/actions/workflows` → `total_count: 0`。仓库无 `.github/`。`ENGINEERING.md`：个人自用，不设强制评审门，不做复杂 CI 矩阵。

---

## 2. 按类型盘点

| 类型 | 现状 | 证据 |
| --- | --- | --- |
| 单元（标记 / 库 / 写回 / overlay / AI） | 强 | 见下表 77/137 |
| 组件或真实渲染 | 无 | 无 jsdom、无 Testing Library；renderer 测的是字符串 HTML / 数字几何 |
| Electron 主进程 | 无 | `app/electron/main.ts`（308 行）无测试；preload 无测试 |
| E2E · UI 交互 | 政策排除 | 默认套件零 Electron 窗口 |
| 视觉回归 | 政策排除 | 无截图基线 |
| 手工验收 | 唯一 UI 门 | STUDY_RELEASE 多次写「桌面人工验收由用户进行」 |

`*.test.*` 20 个，全部已列入 `npm test`，按文件计数：

| 文件 | 项 | 实际测什么 |
| --- | --- | --- |
| `app/marks/marks.test.ts` | 10 | 解析 / 嵌套 / strip 可逆 / 交叉损坏 |
| `app/library/library.test.ts` | 11 | 磁盘读写、标题、PDF 宿主三件套 |
| `app/library/frontmatter.test.ts` | 6 | YAML `title:` |
| `app/write/loop.test.ts` | 20 | 无 UI 写回路、会话栈、编辑重定位 |
| `app/pdf/overlay.test.ts` | 7 | QuadPoints、overlay 增删、不改 PDF 字节 |
| `app/ai/*.test.ts`（5 文件） | 18 | 提交、校验、检索缓存、CLI 发现 |
| `app/electron/renderer/render.test.ts` | 24 | markdown-it 子集 + 消毒 + 铆点占位字符串 |
| `app/electron/renderer/highlight.test.ts` | 7 | Source 高亮 HTML 字符串 |
| `app/electron/renderer/pdf-window.test.ts` | 9 | 可见页窗口算术；文件头写明不测 IntersectionObserver / canvas |
| `app/electron/renderer/pdf-nav.test.ts` | 8 | 页码/缩放 clamp、阅读位置数字 |
| `app/electron/renderer/layout.test.ts` | 3 | 列宽 clamp 与 localStorage 往返 |
| `app/electron/renderer/geometry.test.ts` | 4 | 假 `getClientRects`、数学矩形合并 |
| `app/electron/renderer/card-order.test.ts` | 2 | 假 DOM `moveBefore` |
| `app/electron/renderer/card-height.test.ts` | 3 | 高度算术 + 置顶摘录重定位（混在同一文件） |
| `app/electron/renderer/side-pins.test.ts` | 2 | Pin 偏好的 Map 存储，无卡片显隐 |
| `app/electron/katex-source-map.test.mjs` | 3 | vm 里跑 instrument 后的 KaTeX HTML |

合计 137。

未进 `npm test` 的探针（都不是窗口体验套件）：

| 文件 | 性质 |
| --- | --- |
| `app/ai/pdf-smoke.cjs` | **唯一真实 Electron + PDF.js**：隐藏 `BrowserWindow`，测文字提取与选区 PNG。需先 `build:app`，无 npm script |
| `app/ai/live-smoke.mjs` / `live-pdf-smoke.mjs` / `freedom-smoke.mjs` | 付费 Codex 链路，合成库；ENGINEERING 写明不自动跑 |
| `npm run codex:check` | CLI 握手，无 UI |

手工清单：`app/README.md` 的 M1 步骤、`SETUP_WINDOWS.md` 的临时库 Ask Codex。没有把「侧栏拖宽、源滚出视口、焦点、空态」写成可重复验收项。

壳代码体量（无对应 UI 测试）：

| 文件 | 行数 | 测试触及 |
| --- | --- | --- |
| `renderer.ts` | 2476 | 无 import |
| `pdf-view.ts` | 871 | 仅 pdf-smoke（不在 npm test） |
| `styles.css` | 928 | 无 |
| `pins.ts`（顶部置顶带） | 224 | 无（`pin-model.ts` 有 1 项摘录重定位） |
| `main.ts` | 308 | 无 |
| `math-anchors.ts` | 81 | 无（`mathRegions` 纯函数在 geometry 测试里） |
| `layout.ts` 的 `bindVSplitter` | ~47 | 无 |

`find app -name '*.test.*'` 与 `rg playwright|jsdom|puppeteer|cypress|vitest package.json package-lock.json`：无 UI 测试框架。

---

## 3. 典型体验风险 vs 覆盖

| 风险 | 产品里有没有 | 测试 | 缺口 |
| --- | --- | --- | --- |
| 卡顿 | 有。`renderColumns()` 每次 `disposePdfViews()` 再 `replaceChildren()`；PDF 用 IntersectionObserver ±2 overscan、resize 防抖 120ms | 只测窗口**算术**。文件头：`IntersectionObserver / canvas mount-unmount are not covered here.` | **零**真实滚动/挂载/卸载 |
| 布局跳动 | 有。分割条、列宽 persist、视口藏卡片（结论第 36 条：不收列、不改列宽） | 只测 clamp 后的 CSS 字符串和 storage JSON | **零**拖动、**零**「卡片 hidden 但列宽不变」 |
| PDF 选区 | 有。`pdf-view.ts` overlay `pointerdown/move` 框选 | overlay 模型测磁盘矩形；pdf-smoke 测**已有** rect 出 PNG | **零**拖框、准星、松手、右键 New side |
| 侧边栏 / 侧注开合 | Pieces 侧栏只有拖宽，没有折叠按钮。侧注卡片按来源是否在视口设 `card.hidden`；Pin 覆盖该规则；置顶带可折叠 | Pin 只测 localStorage；会话开合在 `write/session.ts`（无 DOM） | **零**滚动显隐、**零**拖侧栏、**零**置顶带折叠 |
| 焦点 | 有。建 side / 恢复草稿 / 对话框多处 `editor.focus()`、`setSelectionRange` | `renderColumns` 会暂存 selection 再写回，无测试 | **零** |
| 空态 / 错态 | 有。`#sidebar-empty`、`.empty-main`、`setStatus(..., true)`、未选区提示 | 库层 `assert.throws` 很多；DOM 文案与 status.danger **未断言** | **弱到零** |
| 多窗口 | 开发主进程只建一个 `BrowserWindow`。单实例锁在封存包装层，不在这份 `main.ts` | — | 不是测试缺口，是**产品未做**。不必为未做能力补 E2E |

公式选区 / 合并高亮：KaTeX source map 与 `mathRegions` 有字符串/矩形测试；`paintMathRegions` 的真实布局、字体加载后重算、悬停外框 **无 DOM 测试**。STUDY_RELEASE 靠「浏览器真实检查」补过一次，未进默认套件。

---

## 4. 判断（允许并列）

**主因 A：缺测试类型（政策如此）。**  
`ENGINEERING.md` 把测试范围限定在标记代数、库 I/O、无 UI 写回路、overlay、视图像**纯函数**。明确不做 snapshot 与 Electron E2E。因此 UI 体验从一开始就不在门内。

**主因 B：缺少真实 Electron/UI 跑法。**  
137 项全在 Node 进程。唯一窗口探针 `pdf-smoke.cjs` 未挂 script、测的是 AI 用的离屏 PDF 捕获，不是学习主界面。封版记录反复把界面交给用户人工看。

**次因 C：断言太浅（仅限已测的 UI 邻接模块）。**  
layout 测 clamp，不测 `bindVSplitter`。geometry 用假 rect。card-order 用假 `moveBefore`。这些文件让人误以为「壳测过了」，实际只测了可抽纯函数。

**次因 D：缺门禁。**  
无 CI；`npm test` 是硬编码名单；付费 smoke 与 pdf-smoke 默认不跑。类型检查与测试都只在开发者本机记得跑时存在。这解释「回归无人挡」，不单独解释「体验一直差」。

**并列、但不是主因：产品债。**  
`renderer.ts` 约 2500 行命令式壳，列重建会拆掉 PDF 视图。这会放大卡顿/跳动，也让补测更难。可是：**即使不还这笔债，P0 也可以先用黑盒窗口测空态和拖条。** 不能说「测试已经够」。

对 owner 的一句话：数据正确性测试够；窗口体验测试按设计几乎没有。用户觉得 UI 一直有问题，与测试策略一致，不需要先假设某一处产品 bug。

---

## 5. 分阶段方案（先不改业务）

原则：默认套件继续只测数据（与现政策兼容）。新 UI 跑法用**可选 script**，合成库 / 临时目录，**禁止**正式 `paul` 库。不把新界面设想写成封版门槛。

推荐工具（与现栈兼容）：

- 单元：继续 `node:test`，不要并行引入 Jest/Vitest。
- 窗口：Playwright 的 `_electron` 启动本仓库的 Electron（已是 devDependency）。不要 Cypress / Spectron。
- 现成资产：`pdf-smoke.cjs` 已证明隐藏窗口 + PDF.js 可行，可先接到 npm script。
- 不要 jsdom 冒充布局：分割条、PDF 页高、KaTeX 盒子需要真 layout。
- 视觉回归放到 P2；与现行「不做 UI snapshot」冲突，须 owner 明确放开。

### P0 — 最小可验证试点

目的：用一条自动跑法证明「缺窗口测试」这个判断，而不是开始改壳。

做：

1. `package.json` 增加 `test:pdf-smoke`：`build:app` 后跑现有 `app/ai/pdf-smoke.cjs`（仍用合成 PDF + 临时 profile）。
2. 新增 **一个** Playwright Electron 文件（建议 `app/electron/ui-smoke.spec.ts`），临时库 `--library`：
   - 进程起来，无 renderer crash；
   - 未开库时 `#sidebar-empty` 与 `.empty-main` 文案存在；
   - 拖 `#split-sidebar` 后侧栏宽度变化（这就是「侧栏开合」在本产品里的真实操作）。
3. **不改** `renderer.ts` / `pdf-view.ts` / 主进程业务。
4. `ENGINEERING.md` 只加一句：可选 `test:ui`，不替代 `npm test`，不是封版门槛。

不做：截图对比、完整划选挂 side、连 GitHub Actions、重构壳。

工作量：1 个新测试文件 + 1～2 条 script + 1 个 devDependency（Playwright）。约几十行测试，不碰业务。

风险：Playwright 与 Electron 37 版本要钉死；Linux CI 与 Windows 学习机显示可能不一致——P0 只断言 DOM/几何，不比像素。头屏 Windows 上跑一次即可。

成功：owner 本机 `npm test` 仍 137；`npm run test:ui` 能红/绿。若这条都红，说明问题在启动/预加载，不在「缺 case 类型」。

### P1 — 关键交互，仍尽量不改业务

在 P0 绿的前提下，用同一套 Playwright Electron 补学习主路径（合成库）：

1. 文本：开库 → New piece → 输入 → 划选 → New side → 下一列出现；Close 后钉仍在磁盘（磁盘断言复用现有 Library API）。
2. 结论 36：源滚动使未 Pin 侧注 `hidden`，列宽不变；Pin 后仍显示。
3. PDF：框选 → 右键菜单项出现（不必接 Codex）；跳页/缩放不炸。
4. 空/错态：未划选就 New side → footer `danger` 提示。
5. 焦点：New side 后编辑器在新卡片且可输入。

门禁建议：换版前本机清单 = `typecheck:app` + `npm test` + `test:ui`。**不要**做成复杂 CI 矩阵。若以后要自动门，只加 **一条 Windows** workflow，与学习机一致；Linux 可继续只跑 `npm test`。

工作量：约 6～10 个 spec，主要是选择器与合成夹具。若选择器在 2500 行 `renderer.ts` 里不稳定，**最小**改动是给关键节点加 `data-testid`（仍算试点级，不是功能改造）。

风险：E2E 易碎。每条只断言 1 个用户可见结果。付费 Codex / 正式库仍禁止。

### P2 — 仅当 P1 仍漏「看起来不对」

- Playwright `toHaveScreenshot`：分栏、PDF 页、公式合并高亮。基线按 Windows 学习机生成。
- 滚动性能：在 pdf-smoke 或 Playwright 里记 raster 页数 / 长文档滚动是否掉出 ±2 窗口（需要给 `pdf-view` 测试钩子，或只做 tracing，不改行为）。
- 主进程：IPC `openLibraryPath` 与单窗口行为的薄测。

不做：为未实现的多窗口产品补测试；不把视觉回归设成封版默认门槛。

风险：截图对字体/DPI 敏感；钩子若加不好会碰到产品代码。P2 才考虑是否抽 `renderer.ts` 里的 `syncViewportSides` 便于单测——那是可测性清理，不是新功能。

---

## 6. 请决定下面哪一档

| 档 | 投什么 | 不投什么 | 何时选 |
| --- | --- | --- | --- |
| **不投** | 维持现状：`npm test` + 人工看桌面 | 任何窗口自动化 | 接受「体验只靠人眼」、且近期不换版 |
| **P0** | 接通 pdf-smoke + 1 条空库/拖条 Electron 烟 | 不改业务、不上 CI、不截图 | 先验证判断，再决定是否加交互 |
| **P1** | P0 + 划选挂 side / 视口藏卡 / PDF 框选 / 空错态 / 焦点 | 不视觉回归、不重构壳（除非加 testid） | 换版前想少靠人工、防止老体验问题 silently 回来 |
| **P2** | P1 + 截图或滚动性能 | 不自动变成封版清单 | P1 绿了仍漏「布局跳一下」这类观感 |

推荐顺序：先 P0。P0 若在 Windows 学习机上稳定，再开 P1。P2 默认不做。

成功标准（本文是否合格）：

- 知道 `npm test` 是什么、跑出 137、框架是 `node:test`。
- 知道窗口/E2E/视觉/主进程/CI 基本为零，且是政策而非遗漏。
- 能按上表选一档，而不必打开 `renderer.ts`。
