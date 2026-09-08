import { sourceId, validateAnswer, cleanNote } from './answer.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractedPages, searchPages, type PdfReader } from './document-text.ts';
import { NOTE_PROMPT } from './note-prompt.ts';
import { readingContext, type RelatedSource } from './reading-context.ts';
import { prepareRevision, applyRevision, type RevisionPlan } from './revise.ts';
import { ulid } from '../marks/index.ts';
import { Library } from '../library/index.ts';
import { pieceView } from '../write/loop.ts';
import { CodexTransport } from './transport.ts';
import { resolveCodexRuntime } from './runtime.ts';
import { atomicWrite, revision, prepareCommit, applyCommit, type CommitPlan } from './commit.ts';
import type { AiStart, AiJobView, AiAnswer, AiModel, AiContext } from '../electron/renderer/ai-types.ts';

type Job = AiJobView & { request: AiStart; revision: string; plan?: CommitPlan; threadId?: string; turnId?: string; readContextIds?: string[]; related?: RelatedSource[]; revisionPlan?: RevisionPlan; webSearches?: number };
export class AiService {
  private jobs = new Map<string, Job>();
  private clients = new Map<string, CodexTransport>();
  private loginClient?: CodexTransport;
  private directory: string;
  pdfReader?: PdfReader;
  constructor(directory: string) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    for (const name of fs.readdirSync(directory).filter(n => /^[A-Z0-9]+\.json$/.test(n))) {
      try {
        const job: Job = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        if (job.status === 'running') { job.status = 'error'; job.error = '上次生成被中断，请重新选择后提问。'; }
        this.jobs.set(job.id, job);
      } catch { /* Keep unreadable journal intact for recovery. */ }
    }
  }
  private save(job: Job): void {
    // Images remain only in memory during generation; the selected anchor and answer suffice for recovery.
    const persisted = { ...job, request: { ...job.request, selectionImage: undefined, contexts: job.request.contexts.map(c => ({ ...c, image: undefined })) } };
    atomicWrite(path.join(this.directory, `${job.id}.json`), JSON.stringify(persisted));
  }
  private view(job: Job): AiJobView {
    const { id, root, hostId, status, progress, answer, error, rawAnswer } = job;
    return { id, root, hostId, status, progress, answer, error, rawAnswer, intent: job.request.intent ?? 'note', original: job.request.intent === 'revise' && job.request.selection.kind === 'text' ? job.request.selection.expected : undefined };
  }
  list(root: string): AiJobView[] { return [...this.jobs.values()].filter(j => j.root === root && j.status !== 'saved').map(j => this.view(j)); }
  status(id: string): AiJobView { return this.view(this.get(id)); }
  private get(id: string): Job { const job = this.jobs.get(id); if (!job) throw new Error('找不到此回答'); return job; }
  private async connect(web = false): Promise<CodexTransport> {
    const args: string[] = [];
    const set = (key: string, value: unknown): void => { args.push('-c', `${key}=${JSON.stringify(value)}`); };
    const configHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const configFile = path.join(configHome, 'config.toml');
    const config = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
    for (const m of config.matchAll(/^\[mcp_servers\.((?:[\w-]+)|(?:"[^"\r\n]+"))\]\s*$/gm)) set(`mcp_servers.${m[1]}.enabled`, false);
    for (const feature of ['apps', 'shell_tool', 'unified_exec', 'shell_snapshot']) set(`features.${feature}`, false);
    set('web_search', web ? 'live' : 'disabled');
    const scratch = path.join(this.directory, 'runtime'); fs.mkdirSync(scratch, { recursive: true });
    const bin = await resolveCodexRuntime();
    const client = new CodexTransport(bin, args, scratch);
    try { await client.initialize(); return client; }
    catch (error) { client.close(); throw new Error(`已找到 Codex，但连接失败：${String(error)}`); }
  }
  private async catalog(client: CodexTransport): Promise<AiModel[]> {
    const models: AiModel[] = []; let cursor: string | undefined;
    do {
      const page = await client.request('model/list', { ...(cursor ? { cursor } : {}), limit: 100 });
      for (const m of page.data) models.push({ id: m.model, label: m.displayName || m.model, images: (m.inputModalities ?? ['text', 'image']).includes('image'), efforts: m.supportedReasoningEfforts.map((e: any) => e.reasoningEffort), defaultEffort: m.defaultReasoningEffort, isDefault: m.isDefault });
      cursor = page.nextCursor || undefined;
    } while (cursor);
    return models;
  }
  async models(): Promise<AiModel[]> {
    const client = await this.connect();
    try { return await this.catalog(client); } finally { client.close(); }
  }
  async login(): Promise<string> {
    this.loginClient?.close();
    const client = await this.connect(); this.loginClient = client;
    const result = await client.request('account/login/start', { type: 'chatgpt' });
    client.on('notification', msg => { if (msg.method === 'account/login/completed') { client.close(); this.loginClient = undefined; } });
    const url = new URL(result.authUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'auth.openai.com' || url.hostname.endsWith('.openai.com') || url.hostname === 'chatgpt.com')) throw new Error('Codex 返回了未知登录地址');
    return url.href;
  }
  start(lib: Library, request: AiStart): AiJobView {
    if ([...this.jobs.values()].some(j => j.status === 'running')) throw new Error('已有回答正在生成，请等待完成或先取消。');
    if (request.root !== lib.root || request.question.length > 4000) throw new Error('资料库或问题无效');
    const host = pieceView(lib.load(request.hostId));
    if (request.selection.kind === 'text') {
      const s = request.selection;
      if (host.medium !== 'text' || host.clean !== s.expected || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > s.expected.length || s.start >= s.end) throw new Error('原文或选区已变化，请重新选择。');
      if (s.end - s.start > 100000) throw new Error('笔记超过十万字符，请缩小选区。');
      const begin = 0, end = Math.min(s.expected.length, 100000);
      request.contexts = [{ id: 'source', label: host.title, text: s.expected.slice(begin, end) }];
    } else if (host.medium !== 'pdf' || request.selection.anchors.length !== 1) throw new Error('请在 PDF 中选择一个区域');
    if (!request.contexts.length || request.contexts.length > 3) throw new Error('上下文页数无效');
    for (const c of request.contexts) {
      if (!c.id || c.text.length > 100000 || (c.image && (!c.image.startsWith('data:image/png;base64,') || c.image.length > 12000000))) throw new Error('上下文过大或图片格式无效');
    }
    if (request.selectionImage && (!request.selectionImage.startsWith('data:image/png;base64,') || request.selectionImage.length > 12000000)) throw new Error('选区图片无效');
    // Validate anchors/mark compatibility before making a paid request, without writing files.
    const rev = revision(lib, request.hostId);
    if (request.intent !== 'revise') prepareCommit(lib, request.hostId, rev, request.selection, { title: 'check', markdown: 'check', sources: [] });
    else if (request.selection.kind !== 'text') throw new Error('只能改进文本笔记');
    const ancestry = readingContext(lib, request.hostId);
    request.contexts.push(...ancestry.excerpts);
    const job: Job = { id: ulid(), root: lib.root, hostId: request.hostId, status: 'running', progress: '正在连接 Codex…', request: structuredClone(request), revision: rev, related: ancestry.related };
    this.jobs.set(job.id, job); this.save(job);
    void this.generate(job);
    return this.view(job);
  }
  private async generate(job: Job): Promise<void> {
    let client: CodexTransport | undefined;
    try {
      client = await this.connect(job.request.web !== false); this.clients.set(job.id, client);
      if (job.status !== 'running') return;
      const account = await client.request('account/read', { refreshToken: false });
      if (!account.account) throw new Error('请点击「连接 Codex」登录，再重新提问。');
      if (account.account.type !== 'chatgpt') throw new Error('此版本使用 ChatGPT 订阅登录。请点击「连接 Codex」切换登录方式。');
      const models = await this.catalog(client);
      const needsImage = Boolean(job.request.selectionImage || job.request.contexts.some(c => c.image));
      const model = job.request.model ? models.find(m => m.id === job.request.model) : models.find(m => m.isDefault && (!needsImage || m.images)) ?? models.find(m => !needsImage || m.images);
      if (!model) throw new Error('所选模型当前不可用，请重新选择');
      if (needsImage && !model.images) throw new Error('所选模型不支持图片，请选择支持图片的模型');
      const effort = job.request.effort || model.defaultEffort;
      if (!model.efforts.includes(effort)) throw new Error('所选推理强度不受该模型支持');
      const selectedPdf = job.request.selection.kind === 'pdf' ? job.hostId : undefined;
      const contexts = job.request.contexts;
      for (const context of contexts) context.id = sourceId(context.id, selectedPdf);
      const read = new Set([contexts[0]!.id, ...contexts.filter(c => c.id.startsWith('parent-')).map(c => c.id)]);
      client.tool = async params => {
        if (job.status !== 'running' || params.threadId !== job.threadId) throw new Error('无权访问此上下文');
        let item: AiContext | undefined;
        if (['read_document', 'document_outline', 'search_document'].includes(params.tool)) {
          const source = job.related?.find(c => c.pieceId === params.arguments?.pieceId);
          if (!source) throw new Error('此文档不在当前笔记的来源关系中');
          const lib = new Library(job.root);
          const piece = pieceView(lib.load(source.pieceId));
          if (params.tool === 'search_document') {
            job.progress = `正在搜索 ${piece.title}…`;
            const loaded = lib.load(piece.id);
            const pages = loaded.medium === 'pdf'
              ? await extractedPages(path.join(this.directory, 'document-text'), loaded.pdfPath, job.root, piece.id, this.pdfReader ?? (() => { throw new Error('PDF 读取服务不可用'); }), () => job.status === 'running', message => { job.progress = message; })
              : [{ page: 1, text: piece.id === job.hostId && job.request.selection.kind === 'text' ? job.request.selection.expected : piece.clean }];
            item = { id: `search-${piece.id}-${ulid()}`, label: `${piece.title} 搜索结果`, text: JSON.stringify({ ...searchPages(pages, params.arguments.query, params.arguments.offset ?? 0), medium: piece.medium }) };
          } else if (piece.medium === 'pdf') {
            const page = params.tool === 'document_outline' ? 0 : params.arguments.page;
            if (!Number.isInteger(page) || page < 0 || (params.tool !== 'document_outline' && page === 0) || !this.pdfReader) throw new Error('PDF 页码或读取服务不可用');
            job.progress = `正在读取 ${piece.title} 第 ${page} 页…`;
            item = await this.pdfReader(job.root, piece.id, page, params.arguments.textOnly === true);
            if (params.arguments.textOnly === true && page > 0 && !item.text.trim()) item.text = '[此页没有提取到文本；请读取原始页面图片。OCR 尚未接入。]';
            item.id = `document-${piece.id}-page-${page}`;
          } else {
            const start = params.arguments.start ?? 0;
            if (!Number.isInteger(start) || start < 0) throw new Error('无效的文本起点');
            const body = piece.id === job.hostId && job.request.selection.kind === 'text' ? job.request.selection.expected : piece.clean;
            item = { id: `document-${piece.id}-${start}`, label: `${piece.title}（字符 ${start} 起）`, text: body.slice(start, start + 30000) + (body.length > start + 30000 ? `\n[后续内容可从 start=${start + 30000} 继续读取]` : '') };
          }
          const existing = contexts.findIndex(c => c.id === item!.id);
          if (existing < 0) contexts.push(item); else contexts[existing] = item;
        } else if (params.tool === 'read_context') item = contexts.find(c => c.id === sourceId(String(params.arguments?.id), selectedPdf));
        else throw new Error('未知工具');
        if (!item) throw new Error('上下文不在本次选区范围内');
        read.add(item.id); job.progress = `正在读取 ${item.label}`;
        (job.readContextIds ??= []).push(item.id);
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ id: item.id, label: item.label, text: item.text }) }, ...(item.image && model.images ? [{ type: 'inputImage', imageUrl: item.image }] : [])] };
      };
      const thread = await client.request('thread/start', { model: model.id, cwd: path.join(this.directory, 'runtime'), ephemeral: true, environments: [], sandbox: 'read-only', approvalPolicy: 'never',
        baseInstructions: NOTE_PROMPT,
        dynamicTools: [
          { type: 'function', name: 'search_document', description: 'Search the whole related document for a literal case-insensitive phrase. Returns matching PDF file page numbers and excerpts, 20 pages per batch. First use prepares reusable rough Markdown; scanned pages may be unsearchable. Use alternative terms if needed. For text notes page=1 means the note, not a PDF page.', inputSchema: { type: 'object', properties: { pieceId: { type: 'string' }, query: { type: 'string', minLength: 1, maxLength: 300 }, offset: { type: 'integer', minimum: 0 } }, required: ['pieceId', 'query'], additionalProperties: false } },
          { type: 'function', name: 'read_context', description: 'Read a supplied context excerpt, including its image when available.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
          { type: 'function', name: 'read_document', description: 'Set textOnly=true for rough PDF text without an image, or omit it to inspect the original page image and text. Read any page of a related source PDF or a 30000-character window of a related note. Use the supplied source relationship list to choose pieceId.', inputSchema: { type: 'object', properties: { pieceId: { type: 'string' }, page: { type: 'integer', minimum: 1 }, start: { type: 'integer', minimum: 0 }, textOnly: { type: 'boolean' } }, required: ['pieceId'], additionalProperties: false } },
          { type: 'function', name: 'document_outline', description: 'Read a related PDF table of contents with page numbers to locate relevant sections.', inputSchema: { type: 'object', properties: { pieceId: { type: 'string' } }, required: ['pieceId'], additionalProperties: false } },
        ],
      });
      job.threadId = thread.thread.id;
      if (job.status !== 'running') return;
      const selected = job.request.selection.kind === 'text' ? job.request.selection.expected.slice(job.request.selection.start, job.request.selection.end) : `PDF 第 ${job.request.selection.anchors[0]!.page} 页图片选区`;
      const input: unknown[] = [{ type: 'text', text: JSON.stringify({ question: job.request.question, intent: job.request.intent ?? 'note', selected, relatedSources: job.related, directSourceExcerpts: contexts.filter(c => c.id.startsWith('parent-')), annotatedExcerpts: job.request.intent === 'revise' ? pieceView(new Library(job.root).load(job.hostId)).rivets.map(r => job.request.selection.kind === 'text' ? job.request.selection.expected.slice(r.start, r.end) : '') : [], availableContext: contexts.map(c => ({ id: c.id, label: c.label })), initialContext: { id: contexts[0]!.id, text: contexts[0]!.text } }) }];
      if (job.request.selectionImage) input.push({ type: 'image', url: job.request.selectionImage });
      if (contexts[0]!.image) input.push({ type: 'image', url: contexts[0]!.image });
      job.progress = `Codex 正在解释选区（${model.id}）…`;
      const outputSchema = { type: 'object', properties: { title: { type: 'string' }, markdown: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } } }, required: ['title', 'markdown', 'sources'], additionalProperties: false };
      let final = '';
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('生成超时，请重试。')), 180000);
        const done = (error?: Error): void => { clearTimeout(timeout); client!.off('notification', onEvent); client!.off('closed', onClose); error ? reject(error) : resolve(); };
        const onClose = (error: Error): void => done(error);
        const onEvent = (msg: any): void => {
          if (msg.params?.threadId !== job.threadId) return;
          if (msg.method === 'item/started' && msg.params.item.type === 'webSearch') job.progress = '正在联网查资料…';
          if (msg.method === 'item/completed' && msg.params.item.type === 'webSearch') job.webSearches = (job.webSearches ?? 0) + 1;
          if (msg.method === 'item/completed' && msg.params.item.type === 'agentMessage') final = msg.params.item.text;
          if (msg.method === 'turn/completed') done(msg.params.turn.status === 'completed' ? undefined : new Error(msg.params.turn.error?.message || '生成已取消或失败'));
        };
        client!.on('notification', onEvent); client!.on('closed', onClose);
        client!.request('turn/start', { threadId: job.threadId, input, outputSchema, effort }).then(result => {
          job.turnId = result.turn.id;
          if (job.status !== 'running') void client!.request('turn/interrupt', { threadId: job.threadId, turnId: job.turnId }).catch(() => {});
        }).catch(done);
      });
      if (job.status !== 'running') return;
      job.rawAnswer = final;
      job.readContextIds = [...read];
      this.save(job); // Preserve evidence before parsing or validating the generated note.
      const answer = validateAnswer(final, read, selectedPdf);
      const labels = [...new Set(answer.sources)].map(id => contexts.find(c => c.id === id)!.label);
      if (job.request.intent !== 'revise') answer.markdown += labels.length ? `\n\n---\n来源：${labels.join('；')}（Codex 生成，可编辑）` : '\n\n---\nCodex 生成，可编辑。';
      job.answer = answer; job.status = 'ready'; job.progress = '回答已就绪';
    } catch (e) { if (job.status === 'running') { job.status = 'error'; job.error = e instanceof Error ? e.message : String(e); job.progress = '生成失败'; } }
    finally { client?.close(); this.clients.delete(job.id); this.save(job); }
  }
  cancel(id: string): AiJobView {
    const job = this.get(id);
    if (job.status === 'running') {
      job.status = 'cancelled'; job.progress = '已取消';
      this.clients.get(id)?.close(); this.save(job);
    }
    return this.view(job);
  }
  editDraft(lib: Library, id: string, expected: string, markdown: string): AiJobView {
    const job = this.get(id);
    if (job.root !== lib.root || job.status !== 'ready' || !job.answer || job.plan || job.revisionPlan) throw new Error('此回答不能编辑，已提交的笔记请在 Source 中修改');
    if (job.answer.markdown !== expected) throw new Error('草稿已变化，请重新打开后编辑');
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 100000 || /<<\/?r\b/.test(markdown)) throw new Error('草稿正文为空、过长或含内部挂接标记');
    job.rawAnswer ??= JSON.stringify(job.answer);
    job.answer.markdown = cleanNote(markdown);
    this.save(job);
    return this.view(job);
  }
  commit(lib: Library, id: string) {
    const job = this.get(id);
    if (job.request.intent === 'revise') throw new Error('修改稿须预览后应用，不能作为自动挂接提交');
    if (job.root !== lib.root || !job.answer || !['ready', 'saved'].includes(job.status)) throw new Error('回答尚未完成或资料库已切换');
    if (!job.plan) { job.plan = prepareCommit(lib, job.hostId, job.revision, job.request.selection, job.answer); this.save(job); }
    applyCommit(job.plan);
    job.status = 'saved'; job.progress = '已保存'; this.save(job);
    return { host: pieceView(lib.load(job.hostId)), side: pieceView(lib.load(job.plan.sideId)), rivetId: job.plan.rivetId };
  }
  applyImprovement(lib: Library, id: string, undo = false) {
    const job = this.get(id);
    if (job.root !== lib.root || job.request.intent !== 'revise' || !job.answer || !['ready', 'saved'].includes(job.status)) throw new Error('修改稿或资料库不匹配');
    if (!job.revisionPlan) {
      if (undo) throw new Error('尚未应用修改');
      job.revisionPlan = prepareRevision(lib, job.hostId, job.revision, job.answer.markdown); this.save(job);
    }
    applyRevision(job.revisionPlan, undo);
    job.status = undo ? 'ready' : 'saved'; job.progress = undo ? '已撤销此次改进' : '改进已应用'; this.save(job);
    return pieceView(lib.load(job.hostId));
  }
  close(): void { for (const j of this.jobs.values()) if (j.status === 'running') this.cancel(j.id); this.loginClient?.close(); }
}
