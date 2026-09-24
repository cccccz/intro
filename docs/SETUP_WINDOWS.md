# 新电脑启动与 Codex 快速检查

## 1. 拉取并启动

安装 Git、Node.js 22.18 或更新的受支持 LTS（需要 npm），以及官方 Codex Windows 应用／兼容的原生 CLI。然后在 PowerShell 执行：

```powershell
git clone https://github.com/cccccz/intro.git
cd intro
node --version
npm ci
npm run codex:check
npm run app
```

已有 checkout 使用 `git pull --ff-only`，再执行 `npm ci`。固定到某个发布快照可用 `git tag --list` 查看标签，然后 `git switch --detach <标签>`。不要在有未提交修改时强行切换。

## 2. 一条命令检查 Codex

```powershell
npm run codex:check
```

此命令先构建，并使用与 intro 相同的 CLI 定位器检查：

1. 找到兼容的可执行文件，显示实际路径。
2. 完成 App Server stdio 握手。
3. 确认当前为 ChatGPT 登录，不输出账号或认证内容。
4. 能读取账户模型目录。

全部显示 PASS 且退出码为 0 即基础配置正常。PowerShell 可用 `$LASTEXITCODE` 检查退出码。这个检查不发送生成请求、不打开或写入 library；它不能证明剩余额度、后续模型响应和所有联网工具一定可用。

当前适配器要求 CLI 的数字版本 >= 0.153.4；正式版和带预发布／构建后缀的版本均可进入握手检查。实际验证版本为 0.153.4 和 0.154.0-alpha.6.2。

## 3. 找不到 CLI 或登录失败

intro 会查找 PATH 中的原生 `codex.exe` 和 Windows Codex 安装的版本目录。`Get-Command codex` 能找到 PowerShell／npm 包装脚本，不等于 intro 能直接启动它。

```powershell
Get-Command codex -ErrorAction SilentlyContinue
```

若自动发现失败，更新官方 Codex 应用，或指定实际的兼容 `codex.exe` 路径（替换下面示例路径）：

```powershell
$env:INTRO_CODEX_BIN = 'C:\实际安装位置\codex.exe'
& $env:INTRO_CODEX_BIN --version
npm run codex:check
npm run app
```

该变量仅影响当前 PowerShell 及其启动的进程。不要复制旧电脑的版本子目录路径，也不要指向 `.cmd`／`.ps1` 包装脚本。错误的显式路径会阻止自动发现；恢复自动发现：

```powershell
Remove-Item Env:INTRO_CODEX_BIN -ErrorAction SilentlyContinue
```

若提示需要 ChatGPT 登录：启动 intro，打开 Ask Codex／Codex 回答，点击「连接 Codex」，完成浏览器登录后重试。也可以对已定位的 CLI 执行 `& $env:INTRO_CODEX_BIN login`。不要从旧电脑复制 auth.json 或在日志中展示密钥。

官方参考：[App Server](https://learn.chatgpt.com/docs/app-server)。

## 4. 最小功能检查

先打开一个新的空文件夹作为临时 library，创建一句测试正文，划词 → Ask Codex，选择账户提供的模型并问一个简单问题。此步骤会实际调用模型、使用额度。确认回答成为 side，关闭重开后仍在，再开始使用正式库。

再检查：

```powershell
npm run typecheck:app
npm test
npm run build:app
```

## 5. 常见问题与数据位置

| 现象 | 快速检查 |
| --- | --- |
| spawn codex ENOENT | 运行 codex:check，检查实际 exe 路径和显式变量 |
| 找到 CLI 但握手失败 | 查看版本，更新 CLI 后重试；保留错误文字 |
| 登录检查通过但生成失败 | 看具体错误：额度、网络、模型可用性仍可能变化 |
| 回答未自动挂接 | 顶部「Codex 回答」可编辑、保存草稿、尝试挂回原选区 |
| 来源确实已修改 | 不强行覆盖；复制草稿到新笔记并手动挂接 |
| 个别公式显示源码 | Source 中修正公式；不必重新生成整篇笔记 |

回答记录通常在 `%APPDATA%\intro\codex-answers\`，包含原始回答、具体错误与读取来源 ID；这是私人内容，不要直接提交 GitHub。较早版本丢失的失败原文无法恢复。全文搜索的 `.extracted.md` 位于其中 `document-text\`，可重建，无数据库；扫描页 OCR 尚未接入。

Git 只同步程序，不同步教材和笔记。换电脑须另行完整复制 library（包括隐藏／侧车文件），再用 Open library 打开；阅读位置和 Pin 属于应用配置，单独复制 library 不包含它们。正式库先备份，不要和测试共用。`Documents\intro-releases\` 里的旧目录是当时的打包快照，`npm start` 不会更新它们。
