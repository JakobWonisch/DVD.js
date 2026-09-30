/**
 * Always-on ring buffer of viewer diagnostics for “Report a problem”.
 * Independent of console debug — users can report without enabling the toolbar.
 */

import { LOG_TAG } from '../projectId.js';

const MAX_ENTRIES = 2500;
const MAX_ENTRY_CHARS = 2000;
const MAX_DUMP_CHARS = 400_000;

type Level = 'log' | 'warn' | 'error' | 'info';

type Entry = {
  t: string;
  level: Level;
  scope: string;
  message: string;
  data?: string;
};

const entries: Entry[] = [];
let sessionStartedAt = new Date().toISOString();

function stamp(): string {
  return new Date().toISOString();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max - 1) + '…';
}

function serializeData(data: unknown): string | undefined {
  if (data === undefined) {
    return undefined;
  }
  try {
    if (typeof data === 'string') {
      return truncate(data, MAX_ENTRY_CHARS);
    }
    return truncate(JSON.stringify(data), MAX_ENTRY_CHARS);
  } catch {
    return truncate(String(data), MAX_ENTRY_CHARS);
  }
}

export function resetSessionLog(): void {
  entries.length = 0;
  sessionStartedAt = new Date().toISOString();
}

export function pushSessionLog(
  level: Level,
  scope: string,
  message: string,
  data?: unknown,
): void {
  entries.push({
    t: stamp(),
    level,
    scope: String(scope || ''),
    message: truncate(String(message || ''), MAX_ENTRY_CHARS),
    data: serializeData(data),
  });
  while (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
}

export function getSessionLogText(): string {
  const lines: string[] = [
    `# ${LOG_TAG} session log`,
    `# started ${sessionStartedAt}`,
    `# dumped ${stamp()}`,
    `# entries ${entries.length}`,
    '',
  ];
  for (const e of entries) {
    const extra = e.data != null ? ` ${e.data}` : '';
    lines.push(
      `[${e.t}] ${e.level.toUpperCase()} ${e.scope}: ${e.message}${extra}`,
    );
  }
  const text = lines.join('\n');
  if (text.length <= MAX_DUMP_CHARS) {
    return text;
  }
  return text.slice(text.length - MAX_DUMP_CHARS);
}

export function getSessionLogMeta(): {
  startedAt: string;
  entryCount: number;
} {
  return { startedAt: sessionStartedAt, entryCount: entries.length };
}
