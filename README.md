# intro

个人用的本地探究工作区。产品结论见 [`docs/结论.md`](docs/结论.md)，工程约定见 [`docs/ENGINEERING.md`](docs/ENGINEERING.md)。`mockup/` 只是假页面；真实现放在 [`app/`](app/README.md)。

```
npm install
npm start
```

`npm start` 与 `npm run app` 相同：编译后打开 Electron。打开空文件夹即可建库：写正文 → 划选 → New side → 再划再挂。或 **Open PDF…** 附入本地 PDF，框选区域挂侧边（侧车 overlay，不写回 PDF）。PDF 列可缩放 / 跳页 / 大纲；分栏可拖；篇名是 YAML `title:` 显示名，文件名 `{id}` 不变。详见 [`app/README.md`](app/README.md)。

新电脑安装与 Codex 自检见 [`docs/SETUP_WINDOWS.md`](docs/SETUP_WINDOWS.md)。Ask Codex 见 [`app/ai/README.md`](app/ai/README.md)。过时的打包记录和计划在 [`docs/history/`](docs/history/)。
