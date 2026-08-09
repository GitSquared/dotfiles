export type LinearResource = "issue" | "project" | "relation" | "subissue";
export type LinearOperation = "get" | "create" | "update" | "delete" | "list" | "link" | "unlink";

export type LinearManageRequest = {
  resource: LinearResource;
  operation: LinearOperation;
  id?: string;
  parentId?: string;
  relatedId?: string;
  relationType?: "blocks" | "duplicate" | "related" | "similar";
  fields?: Record<string, unknown>;
};

export type LinearManageContext = {
  agentSessionId: string;
  issueId?: string;
  teamId?: string;
};

export type LinearManageResult = {
  ok: true;
  resource: LinearResource;
  operation: LinearOperation;
  data: unknown;
};

export function isLinearManageRequest(value: unknown): value is LinearManageRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<LinearManageRequest>;
  return ["issue", "project", "relation", "subissue"].includes(request.resource ?? "")
    && ["get", "create", "update", "delete", "list", "link", "unlink"].includes(request.operation ?? "")
    && (request.id === undefined || typeof request.id === "string")
    && (request.parentId === undefined || typeof request.parentId === "string")
    && (request.relatedId === undefined || typeof request.relatedId === "string")
    && (request.relationType === undefined || ["blocks", "duplicate", "related", "similar"].includes(request.relationType))
    && (request.fields === undefined || (typeof request.fields === "object" && request.fields !== null && !Array.isArray(request.fields)));
}
