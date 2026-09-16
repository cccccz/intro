# ENGINEERING

## 产品权威

产品规格以根目录 `结论.md` 为准。与 `mockup/` 冲突时跟结论：改演示，或改结论。不要让假页面盖过结论。

实现若改动硬结论，必须在同一 PR 里改 `结论.md`，并写明改了哪几条。

## 当前成功标准

用户已认可当前版本可用于学习。自 2026-09-05 起，优先封存使用版并开展日常学习；维护范围及旧库保护规则见 `STUDY_RELEASE.md`。已有 M1 回路是基础，不再通过追加功能延后投入使用。数据错挂、丢失、无法打开或保存优先于新功能；后续开发使用测试库或正式库副本。

## 目录

真实现只放 `app/`。`mockup/` 只是演示，不是规格，也不和 `app/` 共用入口。

## 技术栈

TypeScript + Electron + 本地文件。起步用单 package，不拆多包。

## 流程

`main` 必须随时可打开。短分支、短 PR。个人自用，不设强制多人评审门。

## 测试

现阶段测标记代数（解析 / 嵌套 / 清除可逆 / 交叉视为损坏）、库文件读写、无 UI 的写回路（划选 → `addMark` → 建/开侧边 → 再挂）、PDF 侧车锚（QuadPoints 归一、overlay 增删、挂侧边不改 PDF 字节）、显示名（`.intro.md` 文首 YAML `title:`，strip/persist 正文标记时保留 frontmatter；不建 `.meta.json`）、以及视图像层的纯函数（rivet 范围 → 高亮片段；`rivetId →` 矩形列表的几何；列内 rendered HTML：先铆点再 markdown-it 子集 + 消毒 + 铆点占位；PDF 可见页窗口：相交页 ± 2 页 overscan；页码 clamp；fit-width 倍率 zoom clamp；分栏宽度 persist clamp）。Source 不跑 markdown。

默认 `npm test` 仍只跑上述 `node:test` 名单。可选窗口套件用真实 Electron，不进入默认 `npm test`，也不是换版默认硬门：`test:ui`（`app/electron/ui`，默认不含 visual）、`test:pdf-smoke`（构建后跑现有隐藏窗口 PDF.js 探针）、`test:explore`（有限枚举点击，写出本地报告）。视觉基线、差分、Playwright 报告、explore 证据禁止进 Git。正式学习库 `paul` 禁止用于自动化；只用临时目录或合成库。付费 `live-smoke` 仍不自动运行。

写者壳的高亮与列间导线是视图像（结论第 39 条）：只读铆点 id 与已有标记算出的选区。文本几何由 textarea/HTML 提供；PDF 宿主由 PDF.js 把 overlay 的 page+rect 画成同一套 `[data-rivet]` 盒子。屏幕坐标仍不另存一份权威。PDF 的钉权威在 `{id}.intro.overlay.json`（结论第 40 条），不是 PDF 文件、也不是字符下标。导线只连「打开的铆点 ↔ 打开的侧边卡片」。同层多支叠在该层 panel（第 22 条）。源滚出视口则不画未 Pin 的侧边（第 36、42 条），不是合上；手动 Pin 保留卡片，不画悬空导线。文本标记权威与库 API 不变。侧边 Pin 用新的 `intro:side-pins:v1:` localStorage 偏好，按库及宿主篇/铆点隔离；旧库无记录即未 Pin，无文件迁移。

PDF.js 列只对视口附近的页 raster：每页先用 `getViewport` 占位（正确总高度，不铺全文档 canvas）。`IntersectionObserver`（root = `.body-pdf`）给出相交页，再向两侧各扩 `PDF_OVERSCAN_PAGES = 2`；滚远的页拆掉 canvas/overlay，滚回再画（overlay 仍从 sidecar rivets 投影）。Resize 防抖 120ms，只重绘当前窗口，不无条件重绘全书。

标记语法见 [`app/marks/SYNTAX.md`](app/marks/SYNTAX.md)。根目录跑 `npm test`（`node:test`，不动 mockup 的 `tsc`）。

## 磁盘上的一篇

库是一个目录。文本篇 = `{id}.intro.md`（文首可选 YAML `title:` 显示名；`{id}` 仍是文件名主干 / 铆点 `to=`）。PDF 宿主 = `{id}.intro.host.json` + 不可变 `{id}.pdf` + `{id}.intro.overlay.json`。PDF 侧边仍是 `{id}.intro.md`，同一套 frontmatter。不建 `.meta.json` 或标题库。详见 [`app/README.md`](app/README.md)。

## 明确不做

账号、同步、多环境、商店持续发布、复杂 CI 矩阵、插件框架。

## 工作区包

工作区包出现时必须带 `formatVersion`。破坏性变更升版本。

## 阶段

- P0：文档
- P1：`app/` 里的标记与库
- P2：M1 Electron 写回路（视图像高亮/导线 + 源出视口则不画侧边）
- P3：置顶带（第 36 条视口藏侧边已随 P2）
- PDF 宿主第一可用路径（owner 顺序 ④，在 md rendered 之后）：侧车 overlay + 最小 PDF.js 列（可见页 virtualization）。不是完整 M5 保真度。
- P4+：以后再说

公式局部标注与编辑：见 STUDY_RELEASE.md 第三次学习版。数学占位符不进入 KaTeX；构建 adapter 保留解析器源码位置，显示层投影高亮与连线。beforeinput 编辑批次带 expected 原文，经主进程校验后重定位锚点；破坏来源边界的编辑拒绝保存并保留本地草稿。
数学标注背景由独立 SVG 层按锚点合并相邻元素矩形绘制；hot 状态只描外框，glyph 不描边。连线共用合并区域，显示层不写回。

Ask Codex 开发版：实现位于 `app/ai/`，入口复用右键选区。主进程运行官方 App Server（已验证 CLI 0.153.4），通过客户端动态只读工具按需返回本次捕获的上下文；这是实验性协议适配边界。默认 ChatGPT 登录，禁用普通执行、apps 及识别到的用户 MCP；联网按用户选项使用 live 或 disabled。PDF 由现有 renderer 中的 PDF.js 捕获选区／本页图片及相邻页，不把整本书发送出去。主进程仅接收和校验生成内容；模型不写库。

AI 写回通过 `commit.ts`：生成完成先保存到应用配置的 `codex-answers` 草稿，记录原文版本；原选区一致时记录提交计划，再写普通 side 和现有宿主标记／overlay。每个文件用临时文件 + rename 替换；跨文件通过日志重试恢复，不宣称跨文件原子事务。开着两个进程编辑同一 library 仍不受支持。写回回归纳入 `npm test`；真实付费探针 `live-smoke.mjs` / `live-pdf-smoke.mjs` 不自动运行。用户决定换版前不覆盖桌面入口。

自由笔记助手：`note-prompt.ts` 为固定指令；`reading-context.ts` 构建直接来源和完整祖先关系目录。read_document / document_outline 通过 renderer 的异步只读桥接访问任意有效 PDF 页或目录；不修改 PDF，也不把整本文档一次送入模型。`revise.ts` 用唯一原片段映射保留子 side，并将应用／撤销前后的原始文件记录在请求日志中。模型列表和推理选项从账户目录动态加载。


2026-09-09 开发版：按需检索。上下文足够时直接回答；缺少定义、前文依据、交叉引用或有来源疑问时主动检索。新增 search_document，对关联全文做不区分大小写的短语搜索并返回页码／片段／分页结果；首次搜索 PDF 使用 PDF.js 逐页提取，生成应用配置目录 codex-answers/document-text 下以内容 SHA-256 命名的 .extracted.md 缓存，不写 library。read_document 支持 textOnly；原图读取保留。扫描空页明确标记，零命中不等于原书不存在。OCR 尚未接入，无数据库。正式桌面入口未替换。


2026-09-09 回答校验修复（开发版）：当前选中 PDF 的 page-N 来源统一为 document-ID-page-N，并兼容模型返回的短别名；不会接受未读取页或其他 PDF 的同页号。解析／校验前将原始回答和实际读取 ID 写入原有回答日志，错误细分为 JSON、正文、内部标记和未知来源；失败原文在 Codex 回答草稿中只读展示供复制，不自动写 side。旧日志缺少 rawAnswer 仍可打开；此前丢失的失败原文无法补回。135 项测试、类型检查、构建通过，正式库与桌面入口未改动。


2026-09-09 开发版草稿修复：回答草稿可编辑并单独保存，挂接前先保存草稿；保存采用预期正文校验，已有提交计划不允许改写。PDF 无编辑框不再误判为未保存编辑。清理 ANSI 终端控制码并保留原始回答；新笔记个别公式渲染失败不阻断保存，源码仍可编辑。旧回答日志兼容，未修改正式库或桌面入口。
