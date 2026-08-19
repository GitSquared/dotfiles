import { finalText } from "./redaction.js";

export type PlanStatus = "pending" | "inProgress" | "completed" | "canceled";

export type PlanItem = {
  id: number;
  content: string;
  status: PlanStatus;
};

export type PlanDetails = { items: PlanItem[]; nextId: number };

export type PlanDisposition = {
  id: number;
  disposition: "done" | "blocked" | "deferred" | "abandoned";
  note: string;
  owner?: string;
  nextAction?: string;
};

export type PlanRequest = {
  action: "list" | "replace" | "add" | "update" | "remove" | "reconcile";
  steps?: Array<{ content: string; status: PlanStatus }>;
  id?: number;
  content?: string;
  status?: PlanStatus;
  dispositions?: PlanDisposition[];
};

export function emptyPlan(): PlanDetails {
  return { items: [], nextId: 1 };
}

export function applyPlanRequest(plan: PlanDetails, request: PlanRequest): PlanDetails {
  if (request.action === "list") return structuredClone(plan);
  if (request.action === "reconcile") {
    if (!request.dispositions) throw new Error("reconcile requires dispositions");
    return reconcilePlan(plan, request.dispositions);
  }
  if (request.action === "replace") {
    if (!request.steps) throw new Error("replace requires steps");
    return {
      items: request.steps.map((step, index) => ({
        id: index + 1,
        content: finalText(step.content).slice(0, 500),
        status: step.status,
      })),
      nextId: request.steps.length + 1,
    };
  }

  const updated = structuredClone(plan);
  if (request.action === "add") {
    if (!request.content) throw new Error("add requires content");
    updated.items.push({
      id: updated.nextId++,
      content: finalText(request.content).slice(0, 500),
      status: request.status ?? "pending",
    });
    return updated;
  }

  if (request.id === undefined) throw new Error(`${request.action} requires id`);
  const index = updated.items.findIndex((item) => item.id === request.id);
  if (index < 0) throw new Error(`Plan item ${request.id} does not exist`);
  if (request.action === "remove") {
    updated.items.splice(index, 1);
    return updated;
  }

  const item = updated.items[index];
  if (!item) throw new Error(`Plan item ${request.id} does not exist`);
  if (request.content) item.content = finalText(request.content).slice(0, 500);
  if (request.status) item.status = request.status;
  if (!request.content && !request.status) throw new Error("update requires content or status");
  return updated;
}

export function reconcilePlan(plan: PlanDetails, dispositions: PlanDisposition[]): PlanDetails {
  const byId = new Map<number, PlanDisposition>();
  for (const disposition of dispositions) {
    if (byId.has(disposition.id)) throw new Error(`Plan item ${disposition.id} has more than one closure disposition`);
    byId.set(disposition.id, disposition);
  }
  const knownIds = new Set(plan.items.map((item) => item.id));
  const unknown = dispositions.find((disposition) => !knownIds.has(disposition.id));
  if (unknown) throw new Error(`Plan item ${unknown.id} does not exist`);
  const missing = plan.items.filter((item) => !byId.has(item.id)).map((item) => item.id);
  if (missing.length) throw new Error(`Closure must disposition every plan item; missing: ${missing.join(", ")}`);

  return {
    nextId: plan.nextId,
    items: plan.items.map((item) => {
      const closure = byId.get(item.id);
      if (!closure) throw new Error(`Closure disposition missing for plan item ${item.id}`);
      if (["blocked", "deferred"].includes(closure.disposition) && !closure.nextAction?.trim()) {
        throw new Error(`${closure.disposition} plan item ${item.id} requires nextAction`);
      }
      const suffix = [
        `${closure.disposition.charAt(0).toUpperCase()}${closure.disposition.slice(1)}: ${finalText(closure.note).slice(0, 140)}`,
        closure.owner?.trim() ? `Owner: ${finalText(closure.owner).slice(0, 60)}` : undefined,
        closure.nextAction?.trim() ? `Next: ${finalText(closure.nextAction).slice(0, 120)}` : undefined,
      ].filter(Boolean).join("; ");
      return {
        ...item,
        content: `${item.content.slice(0, 160)} — ${suffix}`.slice(0, 500),
        status: closure.disposition === "done" ? "completed" as const : "canceled" as const,
      };
    }),
  };
}

export function parsePlan(value: unknown): PlanDetails {
  if (!value || typeof value !== "object") throw new Error("Stored plan must be an object");
  const candidate = value as Partial<PlanDetails>;
  if (!Array.isArray(candidate.items) || !Number.isSafeInteger(candidate.nextId) || (candidate.nextId ?? 0) < 1) {
    throw new Error("Stored plan has an invalid shape");
  }
  const statuses = new Set<PlanStatus>(["pending", "inProgress", "completed", "canceled"]);
  const ids = new Set<number>();
  const items = candidate.items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Stored plan contains an invalid item");
    const parsed = item as Partial<PlanItem>;
    if (!Number.isSafeInteger(parsed.id) || (parsed.id ?? 0) < 1 || ids.has(parsed.id as number)
      || typeof parsed.content !== "string" || !parsed.content.trim() || parsed.content.length > 500
      || !statuses.has(parsed.status as PlanStatus)) {
      throw new Error("Stored plan contains an invalid item");
    }
    ids.add(parsed.id as number);
    return { id: parsed.id as number, content: parsed.content, status: parsed.status as PlanStatus };
  });
  const nextId = candidate.nextId as number;
  if (items.some((item) => item.id >= nextId)) throw new Error("Stored plan nextId must exceed every item id");
  return { items, nextId };
}
