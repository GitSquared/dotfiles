export type LinearResource = "issue" | "project" | "document" | "relation" | "subissue";
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

export type LinearUploadRequest = {
  filename: string;
  contentType: string;
  dataBase64: string;
};

export function isLinearManageRequest(value: unknown): value is LinearManageRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<LinearManageRequest>;
  return ["issue", "project", "document", "relation", "subissue"].includes(request.resource ?? "")
    && ["get", "create", "update", "delete", "list", "link", "unlink"].includes(request.operation ?? "")
    && (request.id === undefined || typeof request.id === "string")
    && (request.parentId === undefined || typeof request.parentId === "string")
    && (request.relatedId === undefined || typeof request.relatedId === "string")
    && (request.relationType === undefined || ["blocks", "duplicate", "related", "similar"].includes(request.relationType))
    && (request.fields === undefined || (typeof request.fields === "object" && request.fields !== null && !Array.isArray(request.fields)));
}

export function isLinearUploadRequest(value: unknown): value is LinearUploadRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<LinearUploadRequest>;
  return typeof request.filename === "string"
    && request.filename.length > 0
    && request.filename.length <= 255
    && request.filename === request.filename.split(/[\\/]/).pop()
    && typeof request.contentType === "string"
    && request.contentType.length > 0
    && request.contentType.length <= 200
    && typeof request.dataBase64 === "string"
    && request.dataBase64.length > 0
    && request.dataBase64.length <= 14 * 1024 * 1024
    && request.dataBase64.length % 4 === 0
    && /^[A-Za-z\d+/]+={0,2}$/.test(request.dataBase64);
}
