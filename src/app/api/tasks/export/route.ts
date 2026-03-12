import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getStorePath, readStore, requireApiKey } from "@/lib/task-control-plane";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    requireApiKey(req);
    const store = await readStore();

    const storePath = getStorePath();
    const dir = path.dirname(storePath);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const snapPath = path.join(dir, `tasks.snapshot.${ts}.json`);
    await fs.writeFile(snapPath, JSON.stringify(store, null, 2) + "\n", "utf8");

    return NextResponse.json({ ok: true, snapshotPath: snapPath, store });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
