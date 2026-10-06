import { appendFileSync, constants, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { configDir } from "./config.js";
import { digest, eventBlock, splitEvents } from "./event-merge.js";
import type { LogEntry } from "./types.js";

function canonicalPath(path: string): string {
  path = resolve(path);
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(canonicalPath(parent), basename(path));
}
function journalRoot(vault: string): string { return join(configDir(), "journal", digest(canonicalPath(vault))); }
function targetDir(vault: string, path: string): string { return join(journalRoot(vault), digest(canonicalPath(path))); }

function syncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function durableDirectory(path: string): void {
  if (existsSync(path)) return;
  durableDirectory(dirname(path));
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  syncDirectory(dirname(path));
}

/** Persist before touching the note. One fsynced private file per event, never a shared JSONL rewrite. */
export function captureEvent(vault: string, filePath: string, entry: LogEntry, date: Date, body?: string): void {
  const block = eventBlock(entry, date, body);
  const dir = targetDir(vault, filePath);
  durableDirectory(dir);
  const path = join(dir, `${digest(block)}.json`);
  if (existsSync(path)) return;
  const temporary = `${path}.${process.pid}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify({ filePath: canonicalPath(filePath), block })); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, path);
  syncDirectory(dir);
}

function withLock<T>(path: string, action: () => T): T {
  const deadline = Date.now() + 5000;
  let fd: number;
  while (true) {
    try { fd = openSync(path, "wx", 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = readFileSync(path, "utf8");
        const pid = Number(owner);
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); }
          catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH" && readFileSync(path, "utf8") === owner) unlinkSync(path); }
        } else if (Date.now() - statSync(path).mtimeMs > 30000) {
          unlinkSync(path);
        }
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (Date.now() > deadline) throw new Error("AgentLog journal saved; note is busy. Run agentlog git-sync replay.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { writeFileSync(fd!, String(process.pid)); return action(); }
  finally { closeSync(fd!); unlinkSync(path); }
}

export function replayFile(vault: string, filePath: string): number {
  const dir = targetDir(vault, filePath);
  if (!existsSync(dir) || !existsSync(filePath)) return 0; // Never reopen an archived/deleted day.
  return withLock(`${dir}.lock`, () => {
    if (!existsSync(filePath)) return 0;
    const content = readFileSync(filePath, "utf8");
    const existing = splitEvents(content).events;
    let appended = "";
    let inserted = 0;
    for (const name of readdirSync(dir).filter(n => n.endsWith(".json")).sort()) {
      const record = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (record.filePath !== canonicalPath(filePath) || typeof record.block !== "string") throw new Error("Invalid AgentLog journal record");
      const parsed = splitEvents(record.block);
      if (parsed.text || parsed.events.size !== 1) throw new Error("Invalid AgentLog journal block");
      const [id, block] = [...parsed.events][0];
      if (existing.has(id)) {
        if (existing.get(id) !== block) throw new Error("AgentLog event ID collision; journal preserved");
        continue;
      }
      existing.set(id, block); appended += block; inserted++;
    }
    // Single append syscall, no read/modify/write of handwritten text or earlier events.
    if (appended) {
      // No O_CREAT: a concurrent archive/delete must never recreate the old path.
      const target = openSync(filePath, constants.O_WRONLY | constants.O_APPEND);
      try { appendFileSync(target, appended, "utf8"); }
      finally { closeSync(target); }
    }
    return inserted;
  });
}

export function replayJournal(vault: string): { inserted: number; missing: number } {
  const root = journalRoot(vault);
  const result = { inserted: 0, missing: 0 };
  if (!existsSync(root)) return result;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const recordFile = readdirSync(dir).find(n => n.endsWith(".json"));
    if (!recordFile) continue;
    const { filePath } = JSON.parse(readFileSync(join(dir, recordFile), "utf8"));
    if (typeof filePath !== "string") throw new Error("Invalid journal target");
    const rel = relative(canonicalPath(vault), filePath);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Journal target outside vault");
    if (!existsSync(filePath)) { result.missing++; continue; }
    result.inserted += replayFile(vault, filePath);
  }
  return result;
}
