import { NextRequest, NextResponse } from "next/server";

import { getDatabase, db_helpers } from "@/lib/db";
import { requireApiKey } from "@/lib/task-control-plane";
import { eventBus } from "@/lib/event-bus";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function getDefaultProjectId(db: ReturnType<typeof getDatabase>, workspaceId: number): number {
  const row = db
    .prepare(
      `
      SELECT id
      FROM projects
      WHERE workspace_id = ? AND status = active
      ORDER BY CASE WHEN slug = general THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `
    )
    .get(workspaceId) as { id: number } | undefined;
  if (!row) throw new Error("No active project available in workspace");
  return row.id;
}

/**
 * POST /api/control-plane/tasks
 * Minimal task creator for automation (PMBot, agents).
 * Auth: x-api-key (API_KEY)
 */
export async function POST(req: NextRequest) {
  try {
    requireApiKey(req);

    const body = await req.json().catch(() => ({} as any));
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ ok: false, error: "Invalid body: title is required" }, { status: 400 });

    const description = typeof body?.description === "string" ? body.description : null;
    const priority = typeof body?.priority === "string" ? body.priority : "medium";
    const status = typeof body?.status === "string" ? body.status : "inbox";
    const tags = Array.isArray(body?.tags) ? body.tags : [];
    const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

    const db = getDatabase();
    const workspaceId = 1;
    const actor = "control-plane";

    // Prevent accidental dupes.
    const existing = db.prepare("SELECT id FROM tasks WHERE title = ? AND workspace_id = ?").get(title, workspaceId) as
      | { id: number }
      | undefined;
    if (existing) return NextResponse.json({ ok: false, error: "Task with this title already exists", id: existing.id }, { status: 409 });

    const now = Math.floor(Date.now() / 1000);

    const createTx = db.transaction(() => {
      const projectId = getDefaultProjectId(db, workspaceId);

      db.prepare(
        `
        UPDATE projects
        SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
        WHERE id = ? AND workspace_id = ?
      `
      ).run(projectId, workspaceId);

      const row = db.prepare("SELECT ticket_counter FROM projects WHERE id = ? AND workspace_id = ?").get(projectId, workspaceId) as
        | { ticket_counter: number }
        | undefined;
      if (!row?.ticket_counter) throw new Error("Failed to allocate project ticket number");

      const res = db
        .prepare(
          `
          INSERT INTO tasks (
            title, description, status, priority, project_id, project_ticket_no, assigned_to, created_by,
            created_at, updated_at, tags, metadata, workspace_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          title,
          description,
          status,
          priority,
          projectId,
          row.ticket_counter,
          null,
          actor,
          now,
          now,
          JSON.stringify(tags),
          JSON.stringify(metadata),
          workspaceId
        );

      return Number(res.lastInsertRowid);
    });

    const taskId = createTx();

    db_helpers.logActivity("task_created", "task", taskId, actor, `Created task: ${title}`, { title, status, priority }, workspaceId);

    const created = db.prepare("SELECT * FROM tasks WHERE id = ? AND workspace_id = ?").get(taskId, workspaceId);

    eventBus.broadcast("task.created", created);

    return NextResponse.json({ ok: true, task: created }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg === "Unauthorized") return NextResponse.json({ ok: false, error: msg }, { status: 401 });
    logger.error({ err: e }, "POST /api/control-plane/tasks error");
    return NextResponse.json({ ok: false, error: "Failed to create task" }, { status: 500 });
  }
}
