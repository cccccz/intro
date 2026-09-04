# ENGINEERING

## 产品权威

产品规格以根目录 `结论.md` 为准。与 `mockup/` 冲突时跟结论：改演示，或改结论。不要让假页面盖过结论。

实现若改动硬结论，必须在同一 PR 里改 `结论.md`，并写明改了哪几条。

## 当前成功标准

笔者能在本地从空库走完 M1 写回路：建篇 → 写干净正文 → 划选写入铆点 → 打开侧边 → 再挂一层。读者侧导出与对外传播往后放。

## 目录

真实现只放 `app/`。`mockup/` 只是演示，不是规格，也不和 `app/` 共用入口。

## 技术栈

TypeScript + Electron + 本地文件。起步用单 package，不拆多包。

## 流程

`main` 必须随时可打开。短分支、短 PR。个人自用，不设强制多人评审门。

## 测试

现阶段测标记代数（解析 / 嵌套 / 清除可逆 / 交叉视为损坏）、库文件读写、无 UI 的写回路（划选 → `addMark` → 建/开侧边 → 再挂）、PDF 侧车锚（QuadPoints 归一、overlay 增删、挂侧边不改 PDF 字节），以及视图像层的纯函数（rivet 范围 → 高亮片段；`rivetId →` 矩形列表的几何；列内 rendered HTML：先铆点再 markdown-it 子集 + 消毒 + 铆点占位）。Source 不跑 markdown。不做 UI snapshot，也不做 Electron E2E。

写者壳的高亮与列间导线是视图像（结论第 39 条）：只读铆点 id 与已有标记算出的选区。文本几何由 textarea/HTML 提供；PDF 宿主由 PDF.js 把 overlay 的 page+rect 画成同一套 `[data-rivet]` 盒子。屏幕坐标仍不另存一份权威。PDF 的钉权威在 `{id}.intro.overlay.json`（结论第 40 条），不是 PDF 文件、也不是字符下标。导线只连「打开的铆点 ↔ 打开的侧边卡片」。同层多支叠在该层 panel（第 22 条）。源滚出视口则不画该侧边（第 36 条），不是合上。文本标记权威与库 API 不变。

标记语法见 [`app/marks/SYNTAX.md`](app/marks/SYNTAX.md)。根目录跑 `npm test`（`node:test`，不动 mockup 的 `tsc`）。

## 磁盘上的一篇

库是一个目录。文本篇 = `{id}.intro.md`。PDF 宿主 = `{id}.intro.host.json` + 不可变 `{id}.pdf` + `{id}.intro.overlay.json`。id → 路径由文件名主干解析。详见 [`app/README.md`](app/README.md)。

## 明确不做

账号、同步、多环境、商店持续发布、复杂 CI 矩阵、插件框架。

## 工作区包

工作区包出现时必须带 `formatVersion`。破坏性变更升版本。

## 阶段

- P0：文档
- P1：`app/` 里的标记与库
- P2：M1 Electron 写回路（视图像高亮/导线 + 源出视口则不画侧边）
- P3：置顶带（第 36 条视口藏侧边已随 P2）
- PDF 宿主第一可用路径（owner 顺序 ④，在 md rendered 之后）：侧车 overlay + 最小 PDF.js 列。结论第 40 条五条锁定。不是完整 M5 保真度。
- P4+：以后再说
