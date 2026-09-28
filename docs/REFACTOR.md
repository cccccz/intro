# 重构评估与计划

2026-09-28，基于 `main` 90d4abe。

## 结论

大文件问题集中在渲染层，不是全项目普遍现象。`app/` 共约 13.8k 行（含测试），超过 1000 行的只有 `app/electron/renderer/renderer.ts`（2939 行）。其后是 `styles.css`（1161）、`pdf-view.ts`（873）、`render.ts`（572）；其余文件都不超过 420 行。

标记代数、库读写、写回路、PDF overlay 以及渲染层的纯计算（layout、geometry、card-order、pdf-window 等）已经拆成小模块并有单元测试，这部分不需要重构。需要处理的是 `renderer.ts` 和 `pdf-view.ts` 里的 `mountPdfView`，再加上 IPC 契约的多份手写副本。

`renderer.ts` 也是改动最频繁的文件：全部 44 个提交里有 24 个改过它，和 `styles.css` 并列第一。

## renderer.ts 的具体问题

以下是当前代码里核实过的事实。

1. **状态分散。** 除了 `state` 对象，还有 14 个模块级 `let` / `Map` / `Set`（`persistTimers`、`inputHistory`、`saveQueues`、`pdfViews`、`outlineFolds`、`hotId`、`wireFrame`、`pendingAlign`、`columnStart`、`pendingPdfPage`、`pendingPinAnchor`、`ctxMenu`、`pieceFolds`、`pendingFocus`）。任何函数都能读写，所以这个文件无法在 `node:test` 里实例化，只能靠浏览器测。
2. **大闭包。** `bindPdfHost` 313 行，`bindSurface` 224 行，`renderCard` 163 行。每个函数里同时有 DOM 构建、事件处理、IPC 调用和状态修改。全文件有 119 处 `document.createElement`、44 处 `window.intro.*` 调用。
3. **全量重建。** `renderColumns()` 有 19 个调用点，每次都 `replaceChildren()` 所有列，再手工恢复草稿、滚动位置和选区（1411–1478 行）。丢失阅读位置一类的问题来自这里；拆分时这段也最容易改坏。
4. **OpenNode 逻辑有两份。** `openRoot` / `openSide` / `closeNode` 等在 `renderer.ts` 147–211 行和 `app/write/session.ts` 各有一份。注释写的理由是 "inlined so file:// loads one script"，但渲染层已经是 ES module，并且 import 了 20 个模块，这个理由已经不成立。单元测试测的是 `session.ts` 那份，应用实际运行的是另一份。
5. **IPC 契约手写了 6 份。** 分别在 `api.ts`（`IntroApi` 和 `IPC`）、`renderer.ts`（`IntroApi` 和 DTO 类型）、`preload.cjs`、`main.ts` 的 handler、`harness/bridge.js`、`harness/session.ts` 的 dispatch。已经出现行为差异：`main.ts` 的 `listPieces` / `createPiece` 返回 `lib.list()` 原来的顺序，harness 的 `libraryDto()` 则按 id 排序。所以浏览器回路测到的并不完全是主进程的真实返回。
   - 渲染层之所以复制类型，是因为它的 `tsconfig` 设了 `rootDir: "."`，import 目录外的文件会报 TS6059（已验证）。`api.ts` 已经从 `./renderer/ai-types.ts` 反向 import，所以共享定义放在 `renderer/` 下即可。

`pdf-view.ts` 里的 `mountPdfView` 单个函数约 526 行（347–873），包含页槽虚拟化、raster、overlay 绘制、拖选和 outline 解析。纯窗口计算已经拆到 `pdf-window.ts`，剩下的都是 DOM 和 PDF.js 交互。

`styles.css` 是一个没有分节的文件，有 232 个规则块，靠后的规则会覆盖前面的（例如 `.card-hd` 在 350 行和 875 行各有一处）。拆分它的收益低于拆 TS 文件。

## 不建议做的

- **引入 UI 框架**（React、Vue、Lit）。这会改变全部 DOM 输出，下面的前后对比就失去作用；也和单 package、少依赖的约定冲突。
- **一次性重写 renderer.ts。** 每一步只做一种变换，每一步都能单独验证。
- **拆成多个 package。**

## 保障基础设施

重构前后的一致性由四层检查共同保障。

| 检查 | 命令 | 覆盖范围 |
| --- | --- | --- |
| 单元测试 | `npm test` | 标记、库、写回、overlay、渲染层纯函数、IPC 副本一致性 |
| 类型检查 | `npm run typecheck:app` | 主进程与渲染层 |
| 阅读页契约 | `npm run test:ui` | 第 22、36、42 条导航规则 + `chain.aria.yml` 无障碍树 |
| 前后对比 | `npm run parity` | 15 个场景下的 IPC 调用、库文件、无障碍树、DOM/布局、localStorage、截图 |

### `npm run parity`

这个命令对两个版本（A/B）跑同一组场景，然后逐项比较结果。它不依赖提交到仓库的截图基线。

- **base**：默认是 `HEAD`，也可以用 `--base main` 或任意引用。命令会把它检出到临时 git worktree，共用当前的 `node_modules`，再单独构建渲染层。
- **head**：默认是当前工作区（包括未提交的改动），也可以用 `--head <ref>` 指定。
- 两侧各自使用自己版本的渲染层构建、`app/harness/session.ts`（库和写回代码）和 `bridge.js`。服务端传输层始终用当前版本的 `server.ts`。
- 库使用 `fixture.ts` 生成的合成库，只生成一次，每个场景开始前复制一份到同一个临时路径，所以界面上显示的路径两侧相同。`paul` 会被拒绝。
- 每个检查点记录五样东西：截图、`body` 的无障碍树、DOM 签名（元素、类、data/aria 属性、可见性、取整后的几何盒、滚动位置、表单值）、localStorage。场景结束时还会记录全部 IPC 调用（参数和返回）和库目录的完整内容。
- ULID、UUID 和库路径按首次出现的顺序归一化（`<id1>`、`<library>`），所以两次运行生成不同的 id 也不影响比较。
- 比较规则：文本必须逐字节一致，截图必须逐像素一致（`--pixel-tolerance N` 可以放宽）。有差异的场景会两侧各重跑一次。只有 base 两次结果一致、且 head 重跑后仍然不同，才算确认的差异，命令返回 1；其余的列为“不稳定”。
- 报告写在 `app/harness/artifacts/parity/report/report.md`，包括文本 diff 和差异图（红色为不同像素）。这个目录已被 gitignore。
- 在这台 Linux VM 上用 Chrome 跑 15 个场景，大约需要 2 分钟。浏览器默认用 `msedge`，和 `test:ui` 一样可以通过 `INTRO_BROWSER_CHANNEL` 更换。

建好之后做过的验证：

- 同一版本自比较，结果为一致。
- 临时把 `.card-hd` 的 padding 改 3px，报告在 DOM/布局 diff 里指出了每个受影响元素的坐标变化，并附上差异截图。
- 临时改一句状态栏文案，无障碍树 diff 直接显示了新旧两句。

已知限制：

- 只覆盖场景实际走到的路径。原生菜单和对话框（Open library、Open PDF）、`main.ts` 本身以及真实的 Codex 调用都不在覆盖范围内：harness 用 `session.ts` 代替主进程，AI 调用一律返回“不运行 Codex”。
- 截图只在同一台机器、同一个浏览器上比较，不跨机器，也不提交。
- DOM 签名包含类名和 `style` 属性。只改内部实现的纯重构应该零差异；如果改了 DOM 结构但像素没变，也会报差异。这是有意的严格度：先看报告确认，再接受。
- 场景使用当前的选择器。如果某一步有意改了类名，要在同一个提交里改场景，并预期这个场景会出现一次差异。
- `pdf-new-side` 的最后一个检查点目前不稳定：新建 PDF 侧注后，侧列是否滚动 3px 取决于 `focus()` 和布局谁先完成。这是应用本身的时序问题，报告会把它列为“不稳定”。

### IPC 副本一致性

`app/electron/ipc-contract.test.ts` 检查 6 份契约副本的方法名和通道名是否一致。在第 1 步把它们合并成一份之前，这个测试防止某一处漏改。

## 重构步骤

每一步是一个短 PR。每一步都要通过 `npm test`、`npm run typecheck:app` 和 `npm run test:ui`，并且 `npm run parity -- --base main` 没有确认的差异；如果有差异，要在 PR 里逐条说明为什么接受。第 1、2 步必须做，之后的步骤每一步单独都有价值，可以在任意一步停下。

1. **合并 IPC 契约。** 把 DTO、`IntroApi` 和通道表移到 `app/electron/renderer/contract.ts`，`api.ts` 从那里 re-export，`renderer.ts` 删掉自己的副本。再抽出 `app/electron/handlers.ts`：一个纯函数 `dispatch(lib, method, args)`，同时给 `main.ts`（外面包一层原生对话框）和 `harness/session.ts` 使用。这样浏览器回路测的就是真实的 handler。
   - 这一步会暴露 `listPieces` 的排序差异。需要先决定哪种顺序正确（Electron 里用户看到的是 `lib.list()` 的顺序），parity 预期会在侧栏相关场景报差异。
   - 这一步涉及写回路径，按 AGENTS.md 要求保留 `loop.test.ts` 和 `library.test.ts` 的旧库回归，parity 的 `disk.txt` 也必须一致。
2. **删掉 OpenNode 副本。** 把 `app/write/session.ts` 移到 `app/electron/renderer/open-nodes.ts`（它是视图状态，不是写回逻辑），`write/index.ts` 和 `loop.test.ts` 改为从新位置 import，`renderer.ts` 删掉 147–211 行。
3. **集中渲染层状态。** 新建 `store.ts`，把 `state` 和那 14 个模块级变量放进一个对象，修改一律通过具名函数。不改变行为。
4. **按界面区域拆分 renderer.ts。** 只搬代码，一次搬一块。每个模块接收一个上下文参数（store、`el`、需要的回调），不互相循环 import。
   - `dialogs.ts`：`askTitle`、`promptExistingSide`、`askCodexQuestion`、右键菜单
   - `sidebar.ts`：`renderSidebar`、折叠、筛选
   - `chrome.ts`：`scheduleChrome`、`syncViewportSides`、`paintOffscreenHints`、`drawWires`、`setHot`、`revealRivet`、`alignCard`
   - `text-surface.ts`：`bindSurface`、各个 `paint*`、`applyMode`、保存队列
   - `pdf-host.ts`：`bindPdfHost`、`appendRivetButtons`、`hangFromPdf`
   - `card.ts`：`renderCard`、`renderSideColumn`、`renderHost`
   - `ai-panel.ts`：`askCodex`、`showCodexDrafts`、`showImprovement`
   - `commands.ts`：打开库、打开 PDF、新建、菜单命令
   - 拆完后 `renderer.ts` 只负责组装，目标是 300 行以内。
5. **拆分 `mountPdfView`。** 按页槽虚拟化、overlay 绘制、区域拖选、outline 解析拆成 `pdf-view/` 下的几个文件，`mountPdfView` 的对外签名保持不变。
6. **可选：`renderColumns` 改为增量更新。** 这一步会改变行为，不是纯重构。parity 会在滚动、焦点和选区上报差异，要逐条确认。应当在第 3、4 步之后再做。
7. **可选：`styles.css` 分节或按组件拆分。** 在 `copy-static.mjs` 里合并成一个文件，或者在 `index.html` 里用多个 `link` 引入。

## 建基础设施时发现、但未修的问题

- 从 Rendered 切到 Source 时，编辑器 `focus()` 会把光标放到文末，`scrollTop` 直接跳到底部（合成库里是 1290/1290），读者原来的位置就丢了。
- `pdf-new-side` 里侧列滚动 3px 的时序问题，见上文。
