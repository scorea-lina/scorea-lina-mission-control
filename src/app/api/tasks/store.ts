import fs from "node:fs/promises";
import path from "node:path";

type TaskStatus = "assigned" | "in_progress" | "in_review" | "ready" | "done";

export type Task = {
  id: string;
  title?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  assignee?: string;
  meta?: Record<string, unknown>;
};

export type TaskStore = {
  version: 1;
  updatedAt: string;
  tasks: Record<string, Task>;
};

const STORE_DIR = path.join(process.env.HOME || "", ".openclaw", "mission-control");
const STORE_PATH = path.join(STORE_DIR, "tasks.json");

export function requireApiKey(req: Request) {
  const configured = process.env.API_KEY;
  if (!configured) throw new Error("Server misconfigured: missing API_KEY");
  const got = req.headers.get("x-api-key");
  if (!got || got !== configured) throw new Error("Unauthorized");
}

export async function readStore(): Promise<TaskStore> {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid store");
    if (parsed.version !== 1) throw new Error("Unsupported store version");
    if (!parsed.tasks || typeof parsed.tasks !== "object") throw new Error("Invalid store");
    return parsed as TaskStore;
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      const now = new Date().toISOString();
      return { version: 1, updatedAt: now, tasks: {} };
    }
    throw e;
  }
}

async function atomicWrite(filePath: string, content: string) {
  const tmp = `${filePath}.tmp`;
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(content, "utf8");
    try {
      await fh.sync();
    } catch {
      // best-effort fsync
    }
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, filePath);
}

export async function writeStore(store: TaskStore): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await atomicWrite(STORE_PATH, JSON.stringify(store, null, 2) + "\n");
}

export function isValidStatus(s: any): s is TaskStatus {
  return s === "assigned" || s === "in_progress" || s === "in_review" || s === "ready" || s === "done";
}

export function getStorePath() {
  return STORE_PATH;
}
