import crypto from "node:crypto";
import https from "node:https";
import path from "node:path";
import type { ControllerConfig } from "./config.js";
import type {
  LinearManageContext,
  LinearManageRequest,
  LinearManageResult,
} from "./linear-actions.js";
import { downloadLinearInputs, linearInputReferences, type LinearInputDownload } from "./linear-inputs.js";
import { JsonStore } from "./storage.js";
import type {
  AgentActivityContent,
  AgentActivitySignal,
  AgentActivitySignalMetadata,
  AgentPlanStep,
  AgentSessionWebhook,
  RepositoryCandidate,
  RepositorySuggestion,
} from "./types.js";

const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const OAUTH_URL = "https://api.linear.app/oauth/token";
const GRAPHQL_URL = "https://api.linear.app/graphql";
const STATE_LIFETIME_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 5 * 60_000;

const ISSUE_CREATE_FIELDS = new Set([
  "assigneeId", "cycleId", "delegateId", "description", "dueDate", "estimate", "labelIds", "parentId",
  "priority", "projectId", "projectMilestoneId", "stateId", "subscriberIds", "teamId", "templateId", "title",
]);
const ISSUE_UPDATE_FIELDS = new Set([
  "addedLabelIds", "assigneeId", "cycleId", "delegateId", "description", "dueDate", "estimate", "labelIds",
  "parentId", "priority", "projectId", "projectMilestoneId", "removedLabelIds", "stateId", "subscriberIds",
  "teamId", "title", "trashed",
]);
const PROJECT_CREATE_FIELDS = new Set([
  "color", "content", "description", "icon", "labelIds", "leadId", "memberIds", "name", "priority",
  "startDate", "statusId", "targetDate", "teamIds", "templateId",
]);
const PROJECT_UPDATE_FIELDS = new Set([
  "canceledAt", "color", "completedAt", "content", "description", "icon", "labelIds", "leadId", "memberIds",
  "name", "priority", "startDate", "statusId", "targetDate", "teamIds", "trashed",
]);
const DOCUMENT_UPDATE_FIELDS = new Set(["content", "title"]);

const ISSUE_FIELDS = `
  id identifier title description url priority priorityLabel dueDate
  state { id name type }
  assignee { id name }
  delegate { id name }
  team { id name }
  project { id name url }
  parent { id identifier title url }
  labels { nodes { id name } }
`;

const PROJECT_FIELDS = `
  id name description content url priority priorityLabel startDate targetDate
  status { id name type }
  lead { id name }
  teams { nodes { id name } }
`;

const DOCUMENT_FIELDS = `
  id title content url createdAt updatedAt
  creator { id name }
  issue { id identifier title url }
  project { id name url }
`;

function managedFields(value: Record<string, unknown> | undefined, allowed: Set<string>, label: string): Record<string, unknown> {
  if (!value || !Object.keys(value).length) throw new Error(`${label} requires at least one field`);
  const rejected = Object.keys(value).filter((key) => !allowed.has(key));
  if (rejected.length) throw new Error(`${label} does not allow field${rejected.length === 1 ? "" : "s"}: ${rejected.join(", ")}`);
  return value;
}

function requiredId(value: string | undefined, fallback: string | undefined, label: string): string {
  const id = value?.trim() || fallback?.trim();
  if (!id) throw new Error(`${label} requires an id; this Agent Session is not attached to an issue`);
  return id;
}

type OAuthState = { value: string; expiresAt: number };
type StateFile = { states: OAuthState[] };
type Token = { // yadm-secret-scan: ignore
  accessToken: string; // yadm-secret-scan: ignore
  refreshToken?: string;
  expiresAt: number;
  scope?: string | string[];
  updatedAt: number;
};
type TokenFile = { defaultAppUserId?: string; installations: Record<string, Token> }; // yadm-secret-scan: ignore
type TokenResponse = { // yadm-secret-scan: ignore
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string | string[];
  error_description?: string;
};
type GraphqlError = {
  message?: string;
  extensions?: {
    code?: string;
    userPresentableMessage?: string;
    validationErrors?: Array<{ constraints?: Record<string, string> }>;
  };
};
type GraphqlResponse<T> = { data?: T; errors?: GraphqlError[] };
type LinearUploadCapability = {
  assetUrl: string;
  uploadUrl: string;
  headers: Array<{ key: string; value: string }>;
};
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type AgentSessionSnapshot = {
  id: string;
  status: string;
  appUser: { id: string };
  issue?: {
    id: string;
    identifier?: string;
    title?: string;
    description?: string | null;
    url?: string;
    team: { id: string; name?: string };
  } | null;
  activities: {
    nodes: Array<{
      id: string;
      createdAt: string;
      ephemeral: boolean;
      content: { type: string; body?: string };
    }>;
  };
};

export function documentCreateInput(issueId: string, id: string, title: string, content: string) {
  return { id, issueId, title, content };
}

export function graphqlErrorMessage(error: GraphqlError | undefined, status: number): string {
  if (!error) return `HTTP ${status}`;
  const details = [
    error.extensions?.userPresentableMessage,
    ...(error.extensions?.validationErrors ?? []).flatMap((entry) => Object.values(entry.constraints ?? {})),
  ].filter((value): value is string => Boolean(value?.trim()));
  const message = error.message?.trim() || `HTTP ${status}`;
  return details.length ? `${message}: ${details.join("; ").slice(0, 1_000)}` : message;
}

async function nodeHttpsUpload(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const target = new URL(input instanceof Request ? input.url : input);
  if (target.protocol !== "https:") throw new Error("Linear returned a non-HTTPS upload capability URL");
  const rawBody = init?.body;
  if (!(rawBody instanceof ArrayBuffer) && !ArrayBuffer.isView(rawBody)) throw new Error("Linear upload body is invalid");
  const body = rawBody instanceof ArrayBuffer
    ? Buffer.from(rawBody)
    : Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  if (!("content-length" in headers)) headers["content-length"] = String(body.byteLength);
  if (!("connection" in headers)) headers.connection = "close";
  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method: init?.method ?? "PUT",
      headers,
      agent: false,
      ...(init?.signal ? { signal: init.signal } : {}),
    }, (response) => {
      response.resume();
      response.once("end", () => {
        const status = response.statusCode ?? 500;
        resolve(new Response(null, { status }));
      });
    });
    request.once("error", reject);
    request.end(body);
  });
}

export async function putPreparedLinearUpload(
  capability: LinearUploadCapability,
  contentType: string,
  contents: Uint8Array,
  signal?: AbortSignal,
  fetchImpl: FetchLike = nodeHttpsUpload,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) => Bun.sleep(milliseconds),
): Promise<string> {
  const assetUrl = new URL(capability.assetUrl);
  const uploadUrl = new URL(capability.uploadUrl);
  if (assetUrl.protocol !== "https:" || assetUrl.hostname !== "uploads.linear.app") throw new Error("Linear returned an invalid private asset URL");
  if (uploadUrl.protocol !== "https:") throw new Error("Linear returned an invalid upload capability URL");
  const headers = new Headers({ "content-type": contentType, "cache-control": "public, max-age=31536000" });
  for (const header of capability.headers) headers.set(header.key, header.value);
  const body = contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer;
  let lastFailure = "unknown network failure";
  let attempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (signal?.aborted) throw new Error("Linear file upload was cancelled");
    attempts = attempt;
    try {
      const response = await fetchImpl(uploadUrl, { method: "PUT", headers, body, redirect: "error", ...(signal ? { signal } : {}) });
      if (response.ok) return assetUrl.toString();
      lastFailure = `HTTP ${response.status}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await sleep(250 * 2 ** (attempt - 1));
  }
  throw new Error(`Linear file upload failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${lastFailure}`);
}

export class LinearClient {
  private readonly states: JsonStore<StateFile>;
  private readonly tokens: JsonStore<TokenFile>; // yadm-secret-scan: ignore
  private refreshInFlight: Promise<string> | undefined;

  constructor(private readonly config: ControllerConfig) {
    this.states = new JsonStore(path.join(config.stateDirectory, "oauth-states.json"), { states: [] });
    this.tokens = new JsonStore(path.join(config.stateDirectory, "linear-tokens.json"), { installations: {} }); // yadm-secret-scan: ignore
  }

  async createInstallUrl(): Promise<string> {
    const value = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    await this.states.update((store) => {
      store.states = store.states.filter((state) => state.expiresAt > now);
      store.states.push({ value, expiresAt: now + STATE_LIFETIME_MS });
    });

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", this.config.linearClientId);
    url.searchParams.set("redirect_uri", this.config.linearRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "read,write,app:assignable,app:mentionable");
    url.searchParams.set("state", value);
    url.searchParams.set("actor", "app");
    return url.toString();
  }

  consumeState(value: string): Promise<boolean> {
    return this.states.update((store) => {
      const now = Date.now();
      const accepted = store.states.some((state) => state.value === value && state.expiresAt > now);
      store.states = store.states.filter((state) => state.value !== value && state.expiresAt > now);
      return accepted;
    });
  }

  async completeInstall(code: string): Promise<{ appUserId: string; scope?: string | string[] }> {
    const token = await this.requestToken({ // yadm-secret-scan: ignore
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.linearRedirectUri,
      client_id: this.config.linearClientId,
      client_secret: this.config.linearClientSecret, // yadm-secret-scan: ignore
    });
    const accessToken = this.requireAccessToken(token); // yadm-secret-scan: ignore
    const viewer = await this.graphqlWithToken<{ viewer: { id: string } }>(accessToken, "query Viewer { viewer { id } }");
    const appUserId = viewer.viewer.id;
    const stored = this.toStoredToken(token);
    await this.tokens.update((store) => {
      store.defaultAppUserId = appUserId;
      store.installations[appUserId] = stored;
    });
    return token.scope === undefined ? { appUserId } : { appUserId, scope: token.scope };
  }

  async createActivity(
    agentSessionId: string,
    content: AgentActivityContent,
    options: {
      ephemeral?: boolean;
      signal?: AgentActivitySignal;
      signalMetadata?: AgentActivitySignalMetadata;
    } = {},
  ): Promise<void> {
    const data = await this.graphql<{
      agentActivityCreate: { success: boolean; agentActivity?: { id?: string } };
    }>(
      `mutation CreateAgentActivity($input: AgentActivityCreateInput!) {
        agentActivityCreate(input: $input) { success agentActivity { id } }
      }`,
      {
        input: {
          agentSessionId,
          content,
          ...(options.ephemeral === undefined ? {} : { ephemeral: options.ephemeral }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.signalMetadata === undefined ? {} : { signalMetadata: options.signalMetadata }),
        },
      },
    );
    if (!data.agentActivityCreate.success) throw new Error("Linear rejected agent activity");
  }

  async beginHumanDelegation(issueId: string, appUserId: string): Promise<void> {
    const data = await this.graphql<{
      issue: {
        id: string;
        delegate?: { id?: string } | null;
        state?: { type?: string } | null;
        team: { states: { nodes: Array<{ id: string; position: number }> } };
      };
    }>(
      `query HumanDelegationContext($issueId: String!) {
        issue(id: $issueId) {
          id
          delegate { id }
          state { type }
          team {
            states(filter: { type: { eq: "started" } }) {
              nodes { id position }
            }
          }
        }
      }`,
      { issueId },
    );
    if (data.issue.delegate?.id !== appUserId) return;
    if (["started", "completed", "canceled"].includes(data.issue.state?.type ?? "")) return;
    const started = [...data.issue.team.states.nodes].sort((left, right) => left.position - right.position)[0];
    if (!started) return;
    const updated = await this.graphql<{ issueUpdate: { success: boolean } }>(
      `mutation StartDelegatedIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: data.issue.id, input: { stateId: started.id } },
    );
    if (!updated.issueUpdate.success) throw new Error("Linear rejected delegated issue status update");
  }

  async repositorySuggestions(
    issueId: string,
    agentSessionId: string,
    candidates: RepositoryCandidate[],
  ): Promise<RepositorySuggestion[]> {
    if (!candidates.length) return [];
    const data = await this.graphql<{
      issueRepositorySuggestions: { suggestions: RepositorySuggestion[] };
    }>(
      `query RepositorySuggestions(
        $issueId: String!
        $agentSessionId: String!
        $candidateRepositories: [CandidateRepository!]!
      ) {
        issueRepositorySuggestions(
          issueId: $issueId
          agentSessionId: $agentSessionId
          candidateRepositories: $candidateRepositories
        ) {
          suggestions { hostname repositoryFullName confidence }
        }
      }`,
      {
        issueId,
        agentSessionId,
        candidateRepositories: candidates.map(({ hostname, repositoryFullName }) => ({ hostname, repositoryFullName })),
      },
    );
    return data.issueRepositorySuggestions.suggestions;
  }

  async revokeInstallation(): Promise<void> {
    await this.tokens.update((store) => {
      delete store.defaultAppUserId;
      store.installations = {};
    });
  }

  async updatePlan(agentSessionId: string, plan: AgentPlanStep[]): Promise<void> {
    const data = await this.graphql<{ agentSessionUpdate: { success: boolean } }>(
      `mutation UpdateAgentSession($id: String!, $input: AgentSessionUpdateInput!) {
        agentSessionUpdate(id: $id, input: $input) { success }
      }`,
      { id: agentSessionId, input: { plan } },
    );
    if (!data.agentSessionUpdate.success) throw new Error("Linear rejected Agent Session plan update");
  }

  async addExternalUrl(agentSessionId: string, externalUrl: { label: string; url: string }): Promise<void> {
    const data = await this.graphql<{ agentSessionUpdate: { success: boolean } }>(
      `mutation AddAgentSessionExternalUrl($id: String!, $input: AgentSessionUpdateInput!) {
        agentSessionUpdate(id: $id, input: $input) { success }
      }`,
      { id: agentSessionId, input: { addedExternalUrls: [externalUrl] } },
    );
    if (!data.agentSessionUpdate.success) throw new Error("Linear rejected Agent Session external URL");
  }

  async uploadFile(filename: string, contentType: string, contents: Uint8Array, signal?: AbortSignal): Promise<string> {
    const upload = await this.prepareFileUpload(filename, contentType, contents.byteLength);
    return putPreparedLinearUpload(upload, contentType, contents, signal);
  }

  private async prepareFileUpload(filename: string, contentType: string, size: number): Promise<LinearUploadCapability> {
    const data = await this.graphql<{
      fileUpload: {
        success: boolean;
        uploadFile?: {
          assetUrl: string;
          uploadUrl: string;
          headers: Array<{ key: string; value: string }>;
        } | null;
      };
    }>(
      `mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success
          uploadFile { assetUrl uploadUrl headers { key value } }
        }
      }`,
      { contentType, filename, size },
    );
    const upload = data.fileUpload.uploadFile;
    if (!data.fileUpload.success || !upload) throw new Error("Linear rejected file upload preparation");
    return upload;
  }

  async createDocument(issueId: string, id: string, title: string, content: string): Promise<{ id: string; title: string; url: string }> {
    const data = await this.graphql<{
      documentCreate: { success: boolean; document: { id: string; title: string; url: string } };
    }>(
      `mutation CreateReviewDocument($input: DocumentCreateInput!) {
        documentCreate(input: $input) { success document { id title url } }
      }`,
      { input: documentCreateInput(issueId, id, title, content) },
    );
    if (!data.documentCreate.success) throw new Error("Linear rejected document creation");
    return data.documentCreate.document;
  }

  async updateDocument(id: string, title: string, content: string): Promise<{ id: string; title: string; url: string }> {
    const data = await this.graphql<{
      documentUpdate: { success: boolean; document: { id: string; title: string; url: string } };
    }>(
      `mutation UpdateReviewDocument($id: String!, $input: DocumentUpdateInput!) {
        documentUpdate(id: $id, input: $input) { success document { id title url } }
      }`,
      { id, input: { title, content } },
    );
    if (!data.documentUpdate.success) throw new Error("Linear rejected document update");
    return data.documentUpdate.document;
  }

  async createIssueAttachment(
    issueId: string,
    attachment: {
      title: string;
      url: string;
      subtitle?: string;
      commentBody?: string;
      agentSessionId: string;
    },
  ): Promise<{ id: string; title: string; url: string }> {
    const data = await this.graphql<{
      attachmentCreate: { success: boolean; attachment: { id: string; title: string; url: string } };
    }>(
      `mutation CreateReviewAttachment($input: AttachmentCreateInput!) {
        attachmentCreate(input: $input) { success attachment { id title url } }
      }`,
      {
        input: {
          issueId,
          title: attachment.title,
          url: attachment.url,
          groupBySource: true,
          metadata: { agentSessionId: attachment.agentSessionId },
          ...(attachment.subtitle ? { subtitle: attachment.subtitle } : {}),
          ...(attachment.commentBody ? { commentBody: attachment.commentBody } : {}),
        },
      },
    );
    if (!data.attachmentCreate.success) throw new Error("Linear rejected issue attachment");
    return data.attachmentCreate.attachment;
  }

  async manage(request: LinearManageRequest, context: LinearManageContext): Promise<LinearManageResult> {
    let data: unknown;
    if (request.resource === "issue") data = await this.manageIssue(request, context);
    else if (request.resource === "project") data = await this.manageProject(request);
    else if (request.resource === "document") data = await this.manageDocument(request, context);
    else if (request.resource === "relation") data = await this.manageRelation(request, context);
    else data = await this.manageSubissue(request, context);
    return { ok: true, resource: request.resource, operation: request.operation, data };
  }

  async issueState(issueId: string): Promise<{ id: string; name: string; type: string }> {
    const data = await this.graphql<{ issue: { state: { id: string; name: string; type: string } } }>(
      `query IssueState($id: String!) { issue(id: $id) { state { id name type } } }`,
      { id: issueId },
    );
    return data.issue.state;
  }

  async agentSessionSnapshot(agentSessionId: string): Promise<AgentSessionSnapshot> {
    const data = await this.graphql<{ agentSession: AgentSessionSnapshot }>(
      `query RecoverAgentSession($id: String!) {
        agentSession(id: $id) {
          id status
          appUser { id }
          issue { id identifier title description url team { id name } }
          activities(last: 20, orderBy: createdAt) {
            nodes {
              id createdAt ephemeral
              content {
                __typename
                ... on AgentActivityActionContent { type }
                ... on AgentActivityElicitationContent { type body }
                ... on AgentActivityErrorContent { type body }
                ... on AgentActivityPromptContent { type body }
                ... on AgentActivityResponseContent { type body }
                ... on AgentActivityThoughtContent { type body }
              }
            }
          }
        }
      }`,
      { id: agentSessionId },
    );
    return data.agentSession;
  }

  async downloadInputs(payload: AgentSessionWebhook): Promise<LinearInputDownload> {
    const references = linearInputReferences(payload);
    if (!references.length) return { inputs: [], skipped: [], totalBytes: 0 };
    try {
      return await downloadLinearInputs(payload, await this.accessToken());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        inputs: [],
        skipped: references.map((reference, index) => ({
          label: reference.label || `Linear input ${index + 1}`,
          reason,
        })),
        totalBytes: 0,
      };
    }
  }

  private async manageIssue(request: LinearManageRequest, context: LinearManageContext): Promise<unknown> {
    if (request.operation === "get") {
      const id = requiredId(request.id, context.issueId, "issue get");
      return (await this.graphql<{ issue: unknown }>(
        `query ManagedIssue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
        { id },
      )).issue;
    }
    if (request.operation === "create") {
      const input = managedFields(request.fields, ISSUE_CREATE_FIELDS, "issue create");
      const result = await this.graphql<{ issueCreate: { success: boolean; issue?: unknown } }>(
        `mutation ManagedIssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
        }`,
        { input },
      );
      if (!result.issueCreate.success || !result.issueCreate.issue) throw new Error("Linear rejected issue creation");
      return result.issueCreate.issue;
    }
    if (request.operation === "update" || request.operation === "delete") {
      const id = requiredId(request.id, context.issueId, `issue ${request.operation}`);
      const input = request.operation === "delete"
        ? { trashed: true }
        : managedFields(request.fields, ISSUE_UPDATE_FIELDS, "issue update");
      const result = await this.graphql<{ issueUpdate: { success: boolean; issue?: unknown } }>(
        `mutation ManagedIssueUpdate($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } }
        }`,
        { id, input },
      );
      if (!result.issueUpdate.success || !result.issueUpdate.issue) throw new Error("Linear rejected issue update");
      return result.issueUpdate.issue;
    }
    throw new Error(`issue does not support ${request.operation}; use get, create, update, or delete`);
  }

  private async manageProject(request: LinearManageRequest): Promise<unknown> {
    if (request.operation === "get") {
      const id = requiredId(request.id, undefined, "project get");
      return (await this.graphql<{ project: unknown }>(
        `query ManagedProject($id: String!) { project(id: $id) { ${PROJECT_FIELDS} } }`,
        { id },
      )).project;
    }
    if (request.operation === "create") {
      const input = managedFields(request.fields, PROJECT_CREATE_FIELDS, "project create");
      const result = await this.graphql<{ projectCreate: { success: boolean; project?: unknown } }>(
        `mutation ManagedProjectCreate($input: ProjectCreateInput!) {
          projectCreate(input: $input) { success project { ${PROJECT_FIELDS} } }
        }`,
        { input },
      );
      if (!result.projectCreate.success || !result.projectCreate.project) throw new Error("Linear rejected project creation");
      return result.projectCreate.project;
    }
    if (request.operation === "update" || request.operation === "delete") {
      const id = requiredId(request.id, undefined, `project ${request.operation}`);
      const input = request.operation === "delete"
        ? { trashed: true }
        : managedFields(request.fields, PROJECT_UPDATE_FIELDS, "project update");
      const result = await this.graphql<{ projectUpdate: { success: boolean; project?: unknown } }>(
        `mutation ManagedProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
          projectUpdate(id: $id, input: $input) { success project { ${PROJECT_FIELDS} } }
        }`,
        { id, input },
      );
      if (!result.projectUpdate.success || !result.projectUpdate.project) throw new Error("Linear rejected project update");
      return result.projectUpdate.project;
    }
    throw new Error(`project does not support ${request.operation}; use get, create, update, or delete`);
  }

  private async manageDocument(request: LinearManageRequest, context: LinearManageContext): Promise<unknown> {
    if (request.operation === "list") {
      const issueId = requiredId(request.parentId, context.issueId, "document list");
      return (await this.graphql<{ issue: unknown }>(
        `query ManagedIssueDocuments($id: String!) {
          issue(id: $id) {
            id identifier title url
            documents(first: 50, orderBy: updatedAt) {
              nodes { id title url createdAt updatedAt creator { id name } }
            }
          }
        }`,
        { id: issueId },
      )).issue;
    }
    if (request.operation === "get") {
      const id = requiredId(request.id, undefined, "document get");
      return (await this.graphql<{ document: unknown }>(
        `query ManagedDocument($id: String!) { document(id: $id) { ${DOCUMENT_FIELDS} } }`,
        { id },
      )).document;
    }
    if (request.operation === "update" || request.operation === "delete") {
      const id = requiredId(request.id, undefined, `document ${request.operation}`);
      const input = request.operation === "delete"
        ? { trashed: true }
        : managedFields(request.fields, DOCUMENT_UPDATE_FIELDS, "document update");
      const result = await this.graphql<{ documentUpdate: { success: boolean; document?: unknown } }>(
        `mutation ManagedDocumentUpdate($id: String!, $input: DocumentUpdateInput!) {
          documentUpdate(id: $id, input: $input) { success document { ${DOCUMENT_FIELDS} } }
        }`,
        { id, input },
      );
      if (!result.documentUpdate.success || !result.documentUpdate.document) throw new Error("Linear rejected document update");
      return result.documentUpdate.document;
    }
    throw new Error("document does not support create here; use publish to create, or list, get, update, and delete to manage existing documents");
  }

  private async manageRelation(request: LinearManageRequest, context: LinearManageContext): Promise<unknown> {
    if (request.operation === "list") {
      const id = requiredId(request.id, context.issueId, "relation list");
      return (await this.graphql<{ issue: unknown }>(
        `query ManagedIssueRelations($id: String!) {
          issue(id: $id) {
            id identifier
            relations(first: 100) { nodes { id type relatedIssue { id identifier title url } } }
            inverseRelations(first: 100) { nodes { id type issue { id identifier title url } } }
          }
        }`,
        { id },
      )).issue;
    }
    if (request.operation === "create" || request.operation === "link") {
      const issueId = requiredId(request.id, context.issueId, "relation create");
      const relatedIssueId = requiredId(request.relatedId, undefined, "relation create related issue");
      if (!request.relationType) throw new Error("relation create requires relationType");
      const result = await this.graphql<{ issueRelationCreate: { success: boolean; issueRelation?: unknown } }>(
        `mutation ManagedIssueRelationCreate($input: IssueRelationCreateInput!) {
          issueRelationCreate(input: $input) {
            success
            issueRelation { id type issue { id identifier title url } relatedIssue { id identifier title url } }
          }
        }`,
        { input: { issueId, relatedIssueId, type: request.relationType } },
      );
      if (!result.issueRelationCreate.success || !result.issueRelationCreate.issueRelation) {
        throw new Error("Linear rejected issue relation creation");
      }
      return result.issueRelationCreate.issueRelation;
    }
    if (request.operation === "delete" || request.operation === "unlink") {
      const id = requiredId(request.id, undefined, "relation delete");
      const result = await this.graphql<{ issueRelationDelete: { success: boolean } }>(
        `mutation ManagedIssueRelationDelete($id: String!) { issueRelationDelete(id: $id) { success } }`,
        { id },
      );
      if (!result.issueRelationDelete.success) throw new Error("Linear rejected issue relation deletion");
      return { id, deleted: true };
    }
    throw new Error(`relation does not support ${request.operation}; use list, create/link, or delete/unlink`);
  }

  private async manageSubissue(request: LinearManageRequest, context: LinearManageContext): Promise<unknown> {
    const parentId = requiredId(request.parentId, context.issueId, `subissue ${request.operation}`);
    if (request.operation === "list") {
      return (await this.graphql<{ issue: unknown }>(
        `query ManagedSubissues($id: String!) {
          issue(id: $id) { id identifier title children(first: 100) { nodes { ${ISSUE_FIELDS} } } }
        }`,
        { id: parentId },
      )).issue;
    }
    if (request.operation === "create") {
      const parent = await this.graphql<{ issue: { id: string; team: { id: string } } }>(
        `query ManagedSubissueParent($id: String!) { issue(id: $id) { id team { id } } }`,
        { id: parentId },
      );
      const supplied = managedFields(request.fields, ISSUE_CREATE_FIELDS, "subissue create");
      const input = { ...supplied, parentId: parent.issue.id, teamId: supplied.teamId ?? parent.issue.team.id };
      const result = await this.graphql<{ issueCreate: { success: boolean; issue?: unknown } }>(
        `mutation ManagedSubissueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
        }`,
        { input },
      );
      if (!result.issueCreate.success || !result.issueCreate.issue) throw new Error("Linear rejected subissue creation");
      return result.issueCreate.issue;
    }
    if (request.operation === "link" || request.operation === "unlink") {
      const id = requiredId(request.id, undefined, `subissue ${request.operation}`);
      const input = { parentId: request.operation === "link" ? parentId : null };
      const result = await this.graphql<{ issueUpdate: { success: boolean; issue?: unknown } }>(
        `mutation ManagedSubissueParentUpdate($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } }
        }`,
        { id, input },
      );
      if (!result.issueUpdate.success || !result.issueUpdate.issue) throw new Error("Linear rejected subissue parent update");
      return result.issueUpdate.issue;
    }
    throw new Error(`subissue does not support ${request.operation}; use list, create, link, or unlink`);
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.graphqlWithToken(await this.accessToken(), query, variables);
  }

  private async graphqlWithToken<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> { // yadm-secret-scan: ignore
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json() as GraphqlResponse<T>;
    if (!response.ok || payload.errors?.length) {
      throw new Error(`Linear GraphQL request failed: ${graphqlErrorMessage(payload.errors?.[0], response.status)}`);
    }
    if (!payload.data) throw new Error("Linear GraphQL response contained no data");
    return payload.data;
  }

  private async accessToken(): Promise<string> {
    const store = await this.tokens.read();
    const appUserId = store.defaultAppUserId ?? Object.keys(store.installations)[0];
    if (!appUserId) throw new Error("Linear app has not been installed");
    const token = store.installations[appUserId]; // yadm-secret-scan: ignore
    if (!token) throw new Error("Linear token store is inconsistent");
    if (token.expiresAt - REFRESH_SKEW_MS > Date.now()) return token.accessToken;
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refresh(appUserId, token).finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private async refresh(appUserId: string, current: Token): Promise<string> {
    if (!current.refreshToken) throw new Error("Linear token expired without a refresh token");
    const response = await this.requestToken({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken, // yadm-secret-scan: ignore
      client_id: this.config.linearClientId,
      client_secret: this.config.linearClientSecret, // yadm-secret-scan: ignore
    });
    const accessToken = this.requireAccessToken(response); // yadm-secret-scan: ignore
    const replacement = this.toStoredToken(response, current.refreshToken);
    await this.tokens.update((store) => {
      store.defaultAppUserId = appUserId;
      store.installations[appUserId] = replacement;
    });
    return accessToken;
  }

  private async requestToken(values: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(OAUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
    });
    const payload = await response.json() as TokenResponse;
    if (!response.ok) throw new Error(`Linear OAuth request failed: ${payload.error_description ?? `HTTP ${response.status}`}`);
    return payload;
  }

  private requireAccessToken(response: TokenResponse): string {
    if (!response.access_token || !response.expires_in) throw new Error("Linear OAuth response is incomplete");
    return response.access_token;
  }

  private toStoredToken(response: TokenResponse, previousRefreshToken?: string): Token {
    const refreshToken = response.refresh_token ?? previousRefreshToken; // yadm-secret-scan: ignore
    return {
      accessToken: this.requireAccessToken(response), // yadm-secret-scan: ignore
      ...(refreshToken ? { refreshToken } : {}),
      expiresAt: Date.now() + (response.expires_in ?? 0) * 1_000,
      ...(response.scope === undefined ? {} : { scope: response.scope }),
      updatedAt: Date.now(),
    };
  }
}
