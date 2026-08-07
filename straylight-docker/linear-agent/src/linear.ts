import crypto from "node:crypto";
import path from "node:path";
import type { ControllerConfig } from "./config.js";
import { JsonStore } from "./storage.js";
import type { AgentActivityContent, AgentPlanStep } from "./types.js";

const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const OAUTH_URL = "https://api.linear.app/oauth/token";
const GRAPHQL_URL = "https://api.linear.app/graphql";
const STATE_LIFETIME_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 5 * 60_000;

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
type GraphqlResponse<T> = { data?: T; errors?: Array<{ message?: string }> };

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
    options: { ephemeral?: boolean } = {},
  ): Promise<void> {
    const data = await this.graphql<{
      agentActivityCreate: { success: boolean; agentActivity?: { id?: string } };
    }>(
      `mutation CreateAgentActivity($input: AgentActivityCreateInput!) {
        agentActivityCreate(input: $input) { success agentActivity { id } }
      }`,
      { input: { agentSessionId, content, ...(options.ephemeral === undefined ? {} : { ephemeral: options.ephemeral }) } },
    );
    if (!data.agentActivityCreate.success) throw new Error("Linear rejected agent activity");
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
      throw new Error(`Linear GraphQL request failed: ${payload.errors?.[0]?.message ?? `HTTP ${response.status}`}`);
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
