import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class CodexTransport extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private seq = 0;
  private ended = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  tool?: (params: any) => unknown;
  constructor(bin: string, args: string[], cwd: string) {
    super();
    this.child = spawn(bin, ['app-server', '--stdio', ...args], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout }).on('line', line => {
      try { this.receive(JSON.parse(line)); } catch { this.close(new Error('Codex 协议响应无效')); }
    });
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', error => this.close(error));
    this.child.on('error', error => this.close(error));
    this.child.on('exit', () => this.close(new Error('Codex 连接已关闭')));
  }
  private send(value: unknown): void { if (!this.ended) this.child.stdin.write(JSON.stringify(value) + '\n'); }
  private receive(msg: any): void {
    if (msg.method) {
      if (msg.id !== undefined) {
        void (async () => { try {
          if (msg.method !== 'item/tool/call' || !this.tool) throw new Error('intro 不允许此操作');
          this.send({ id: msg.id, result: await this.tool(msg.params) });
        } catch (e) {
          this.send({ id: msg.id, error: { code: -32602, message: String(e) } });
        } })();
      }
      this.emit('notification', msg);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer); this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  }
  request(method: string, params: unknown = {}, timeout = 30000): Promise<any> {
    if (this.ended) return Promise.reject(new Error('Codex 连接已关闭'));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  async initialize(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'intro', title: 'intro Ask Codex', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
  }
  close(error = new Error('Codex 连接已关闭')): void {
    if (this.ended) return;
    this.ended = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.child.kill(); this.emit('closed', error);
  }
}
