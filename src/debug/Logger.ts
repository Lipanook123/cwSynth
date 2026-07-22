type Level = 'log' | 'warn' | 'error' | 'info';

interface LogEntry {
  t: number;       // ms since logger init
  level: Level;
  msg: string;
}

const MAX_ENTRIES = 1000;

class Logger {
  private entries: LogEntry[] = [];
  private start = Date.now();
  private listeners: Array<() => void> = [];

  private _push(level: Level, args: unknown[]) {
    const msg = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    if (this.entries.length >= MAX_ENTRIES) this.entries.shift();
    this.entries.push({ t: Date.now() - this.start, level, msg });
    this.listeners.forEach(fn => fn());
  }

  log  (...args: unknown[]) { this._push('log',   args); }
  info (...args: unknown[]) { this._push('info',  args); }
  warn (...args: unknown[]) { this._push('warn',  args); }
  error(...args: unknown[]) { this._push('error', args); }

  /** Intercept window errors and unhandled rejections */
  install() {
    window.addEventListener('error', e => {
      this.error(`[uncaught] ${e.message} @ ${e.filename}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', e => {
      this.error(`[promise] ${e.reason}`);
    });
    return this;
  }

  onUpdate(fn: () => void) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  getEntries() { return this.entries as ReadonlyArray<LogEntry>; }

  asText() {
    return this.entries
      .map(e => {
        const ts = String(e.t).padStart(7, ' ');
        return `+${ts}ms [${e.level.toUpperCase().padEnd(5)}] ${e.msg}`;
      })
      .join('\n');
  }

  download() {
    const blob = new Blob([this.asText()], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cwsynth-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  clear() {
    this.entries = [];
    this.listeners.forEach(fn => fn());
  }
}

export const logger = new Logger().install();
