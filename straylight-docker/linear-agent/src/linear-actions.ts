import type {
  AgentActivityContent,
  AgentActivitySignal,
  AgentActivitySignalMetadata,
  AgentPlanStep,
} from "./types.js";

export type LinearResource = "issue" | "project" | "document" | "comment" | "relation" | "subissue";
export type LinearOperation = "get" | "create" | "update" | "delete" | "list" | "link" | "unlink" | "reply" | "resolve" | "unresolve";

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

export type LinearSessionRequest =
  | {
      action: "activity";
      content: AgentActivityContent;
      signal?: AgentActivitySignal;
      signalMetadata?: AgentActivitySignalMetadata;
    }
  | { action: "external_url"; label: string; url: string }
  | { action: "plan"; steps: AgentPlanStep[] }
  | {
      action: "publish";
      publication:
        | { kind: "document"; id: string; title: string; body: string; update: boolean }
        | { kind: "attachment"; title: string; url: string; subtitle?: string; body?: string };
    };

export type LinearSessionResult = { ok: true; action: LinearSessionRequest["action"]; data?: unknown };

function isString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isString(value, 2_000)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }
  catch { return false; }
}

function isActivityContent(value: unknown): value is AgentActivityContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const content = value as Partial<AgentActivityContent>;
  if (["thought", "response", "error", "elicitation"].includes(content.type ?? "")) {
    return isString((content as { body?: unknown }).body, 8_000);
  }
  return content.type === "action"
    && isString((content as { action?: unknown }).action, 500)
    && isString((content as { parameter?: unknown }).parameter, 2_000)
    && ((content as { result?: unknown }).result === undefined || isString((content as { result?: unknown }).result, 8_000));
}

function isSignalMetadata(value: unknown): value is AgentActivitySignalMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  if (Array.isArray(metadata.options)) {
    return metadata.options.length >= 2 && metadata.options.length <= 12 && metadata.options.every((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) return false;
      const item = option as Record<string, unknown>;
      return (item.label === undefined || isString(item.label, 200)) && isString(item.value, 1_000);
    });
  }
  return isHttpsUrl(metadata.url)
    && (metadata.userId === undefined || isString(metadata.userId, 200))
    && (metadata.providerName === undefined || isString(metadata.providerName, 200));
}

export function isLinearSessionRequest(value: unknown): value is LinearSessionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (request.action === "activity") {
    if (!isActivityContent(request.content)) return false;
    if (request.signal === undefined) return request.signalMetadata === undefined;
    if (!isSignalMetadata(request.signalMetadata)) return false;
    const metadata = request.signalMetadata as unknown as Record<string, unknown>;
    return request.signal === "select"
      ? Array.isArray(metadata.options)
      : request.signal === "auth" && isHttpsUrl(metadata.url);
  }
  if (request.action === "external_url") return isString(request.label, 200) && isHttpsUrl(request.url);
  if (request.action === "plan") {
    return Array.isArray(request.steps) && request.steps.length <= 100 && request.steps.every((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return false;
      const item = step as Record<string, unknown>;
      return isString(item.content, 500) && ["pending", "inProgress", "completed", "canceled"].includes(String(item.status));
    });
  }
  if (request.action !== "publish" || !request.publication || typeof request.publication !== "object" || Array.isArray(request.publication)) return false;
  const publication = request.publication as Record<string, unknown>;
  if (publication.kind === "document") {
    return isString(publication.id, 200) && isString(publication.title, 200) && isString(publication.body, 100_000) && typeof publication.update === "boolean";
  }
  return publication.kind === "attachment"
    && isString(publication.title, 200)
    && isHttpsUrl(publication.url)
    && (publication.subtitle === undefined || isString(publication.subtitle, 500))
    && (publication.body === undefined || isString(publication.body, 100_000));
}

export function isLinearManageRequest(value: unknown): value is LinearManageRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<LinearManageRequest>;
  return ["issue", "project", "document", "comment", "relation", "subissue"].includes(request.resource ?? "")
    && ["get", "create", "update", "delete", "list", "link", "unlink", "reply", "resolve", "unresolve"].includes(request.operation ?? "")
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
