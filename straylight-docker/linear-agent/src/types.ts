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
  previousComments?: Array<{ id?: string; body?: string }>;
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
    sourceCommentId?: string | null;
    comment?: {
      id?: string;
      body?: string;
      documentContentId?: string | null;
      parentId?: string | null;
      quotedText?: string | null;
    } | null;
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
    documentId?: string;
    commentId?: string;
    parentCommentId?: string;
    comment?: {
      id?: string;
      body?: string;
      documentContentId?: string | null;
      parentId?: string | null;
      quotedText?: string | null;
    } | null;
    parentComment?: { id?: string } | null;
    issueId?: string;
    issue?: LinearIssue;
    type?: string;
    /**
     * Set by Linear on `issueEmojiReaction`/`issueCommentReaction` notifications
     * (IssueEmojiReactionNotificationWebhookPayload / IssueCommentReactionNotificationWebhookPayload
     * in Linear's schema): the normalized name of the emoji that was reacted with,
     * e.g. "white_check_mark".
     */
    reactionEmoji?: string;
    /** The id of the actor who caused the notification - who placed the reaction, for reaction notifications. */
    actorId?: string;
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

export type LinearProjectContext = {
  id: string;
  name: string;
  url?: string;
  content?: string | null;
};

export type LinearTeamContext = {
  id: string;
  name: string;
  description?: string | null;
};

export type LinearInputFile = {
  filename: string;
  mimeType: string;
  size: number;
  dataBase64: string;
};

export type LinearDocumentReview = {
  document: { id: string; title: string; url: string; content: string };
  comment: { id: string; body: string; quotedText?: string | null; parentId?: string | null };
  thread: Array<{
    id: string;
    body: string;
    quotedText?: string | null;
    parentId?: string | null;
    resolvedAt?: string | null;
    user?: { id: string; name: string } | null;
  }>;
};

export type LinearSourceComment = {
  id: string;
  body: string;
  documentContentId?: string | null;
  parentId?: string | null;
  quotedText?: string | null;
};

export type LinearCommentContext = {
  comment: LinearSourceComment;
  documentReview?: LinearDocumentReview;
};

export type AgentTaskPayload = AgentSessionWebhook & {
  linearInputs?: LinearInputFile[];
  linearSourceComment?: LinearSourceComment;
  linearDocumentReview?: LinearDocumentReview;
  projectContext?: LinearProjectContext;
  teamContext?: LinearTeamContext;
  workbench?: {
    repositories?: RepositoryCandidate[];
    repositorySuggestions?: RepositorySuggestion[];
  };
  resumeConversationId?: string;
};
