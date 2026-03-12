export type TaskStatus = "assigned" | "in_progress" | "in_review" | "ready" | "done";

export type Task = {
  id: number;
  status: TaskStatus;
  updated_at?: number;
  updatedAt?: string;
};

export async function listTasks(baseUrl: string, apiKey: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tasks`, {
    headers: { "x-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`listTasks failed: ${res.status}`);
  return res.json();
}

export async function setTaskStatus(baseUrl: string, apiKey: string, taskId: number, status: TaskStatus) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`setTaskStatus failed: ${res.status}`);
  return res.json();
}
