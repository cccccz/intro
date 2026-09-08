import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

// Experimental integration boundary. No authentication payloads are logged.
export class AppServerClient extends EventEmitter {
  pending = new Map();
  sequence = 0;
  constructor(executable, args, cwd) {
    super();
    this.child = spawn(executable, ['app-server', '--stdio', ...args], {
      cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try { this.receive(JSON.parse(line)); }
      catch (error) { this.fail(error); }
    });
    this.child.stderr.on('data', () => {}); // Do not persist potentially sensitive diagnostics.
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`App Server exited (${code})`)));
  }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.emit('closed', error);
  }
  send(message) { this.child.stdin.write(JSON.stringify(message) + '\n'); }
  receive(message) {
    if (message.method) {
      if (message.id !== undefined) {
        // Probe never grants execution or other permission requests.
        this.send({ id: message.id, error: { code: -32601, message: 'Not supported by intro probe' } });
      }
      this.emit('notification', message);
      return;
    }
    const p = this.pending.get(message.id);
    if (!p) return;
    this.pending.delete(message.id);
    clearTimeout(p.timer);
    if (message.error) p.reject(new Error(JSON.stringify(message.error)));
    else p.resolve(message.result);
  }
  request(method, params = {}, timeout = 30000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  async initialize() {
    const result = await this.request('initialize', {
      clientInfo: { name: 'intro_probe', title: 'intro integration probe', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized', params: {} });
    return result;
  }
  close() {
    this.lines.close();
    this.child.stdin.end();
    this.child.kill();
  }
}
