export type LinearIssue = {
  identifier?: string;
  title?: string;
  description?: string | null;
  url?: string;
};

export type AgentSessionWebhook = {
  type?: string;
  action?: string;
  webhookTimestamp?: number;
  promptContext?: string;
  guidance?: Array<{ body?: string }>;
  agentActivity?: {
    content?: {
      type?: string;
      body?: string;
    };
  };
  agentSession?: {
    id?: string;
    promptContext?: string;
    issue?: LinearIssue | null;
  };
};

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
