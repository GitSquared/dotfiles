export type LinearIssue = {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  url?: string;
  teamId?: string;
  team?: { id?: string; name?: string } | null;
};

export type AgentSessionWebhook = {
  type?: string;
  action?: string;
  appUserId?: string;
  organizationId?: string;
  webhookId?: string;
  webhookTimestamp?: number;
  promptContext?: string;
  guidance?: Array<{ body?: string }>;
  agentActivity?: {
    signal?: string;
    signalMetadata?: Record<string, unknown> | null;
    content?: {
      type?: string;
      body?: string;
      title?: string;
    };
  };
  agentSession?: {
    id?: string;
    appUserId?: string;
    creatorId?: string;
    issueId?: string;
    status?: string;
    url?: string | null;
    promptContext?: string;
    issue?: LinearIssue | null;
  };
};

export type AppUserNotificationWebhook = {
  type?: "AppUserNotification";
  action?: string;
  appUserId?: string;
  webhookId?: string;
  webhookTimestamp?: number;
  notification?: {
    issueId?: string;
    issue?: LinearIssue;
    type?: string;
  };
};

export type PermissionChangeWebhook = {
  type?: "PermissionChange";
  action?: string;
  appUserId?: string;
  webhookId?: string;
  webhookTimestamp?: number;
  canAccessAllPublicTeams?: boolean;
  addedTeamIds?: string[];
  removedTeamIds?: string[];
};

export type OAuthAppWebhook = {
  type?: "OAuthApp";
  action?: string;
  organizationId?: string;
  webhookId?: string;
  webhookTimestamp?: number;
};

export type LinearWebhook =
  | AgentSessionWebhook
  | AppUserNotificationWebhook
  | PermissionChangeWebhook
  | OAuthAppWebhook;

export type AgentActivitySignal = "auth" | "select";

export type AgentActivitySignalMetadata =
  | { options: Array<{ label?: string; value: string }> }
  | { url: string; userId?: string; providerName?: string };

export type AgentActivityContent =
  | { type: "thought"; body: string }
  | { type: "response"; body: string }
  | { type: "error"; body: string }
  | { type: "elicitation"; body: string }
  | { type: "action"; action: string; parameter: string; result?: string };

export type AgentPlanStep = {
  content: string;
  status: "pending" | "inProgress" | "completed" | "canceled";
};

export type RepositoryCandidate = {
  hostname: string;
  repositoryFullName: string;
  path?: string;
};

export type RepositorySuggestion = RepositoryCandidate & { confidence?: number };

export type AgentTaskPayload = AgentSessionWebhook & {
  workbench?: {
    repositories?: RepositoryCandidate[];
    repositorySuggestions?: RepositorySuggestion[];
  };
};
