import crypto from "node:crypto";
import type { ControllerConfig } from "./config.js";
import { AgentController } from "./controller.js";
import { LinearClient } from "./linear.js";
import { isLinearManageRequest, isLinearSessionRequest, isLinearUploadRequest } from "./linear-actions.js";
import { finalText } from "./redaction.js";
import { DeliveryDeduper, freshWebhookTimestamp, verifyWebhookSignature } from "./signature.js";
import type {
  AgentSessionWebhook,
  AppUserNotificationWebhook,
  LinearWebhook,
  PermissionChangeWebhook,
} from "./types.js";

export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_LINEAR_UPLOAD_BODY_BYTES = 15 * 1024 * 1024;

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

type ControllerServer = Pick<Bun.Server<undefined>, "timeout">;

function json(status: number, value: unknown): Response {
  return Response.json(value, {
    status,
    headers: responseHeaders,
  });
}

function text(status: number, value: string): Response {
  return new Response(value, {
    status,
    headers: {
      ...responseHeaders,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function body(request: Request, maximumBytes = MAX_BODY_BYTES): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("request_too_large");
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.byteLength > maximumBytes) throw new Error("request_too_large");
  return raw;
}

function installCredential(request: Request, url: URL): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  return url.searchParams.get("install_secret") ?? undefined;
}

function authorizedInstall(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && crypto.timingSafeEqual(expectedBytes, providedBytes);
}

function authorizedRunner(expected: string, request: Request): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "");
  return authorizedInstall(expected, provided);
}

function matches(pathname: string, route: string): boolean {
  return pathname === `/linear${route}` || pathname === route;
}

export function createServer(
  config: ControllerConfig,
  linear: LinearClient,
  controller: AgentController,
  inbox?: {
    enqueue(body: Buffer, payload: LinearWebhook, now?: number): Promise<boolean>;
    status?(): Promise<Record<string, unknown>>;
  },
): (request: Request, server?: ControllerServer) => Promise<Response> {
  const deduper = new DeliveryDeduper();
  return async (request, server) => {
    try {
      return await route(request, server);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("request failed", { message });
      return json(message === "request_too_large" ? 413 : 500, { ok: false, error: "internal_error" });
    }
  };

  async function route(request: Request, server?: ControllerServer): Promise<Response> {
    const method = request.method;
    const url = new URL(request.url);

    if (method === "GET" && url.pathname === "/healthz") {
      try {
        return json(200, {
          ok: true,
          service: "straylight-linear-agent",
          ...await controller.health(),
          ...(inbox?.status ? { webhookInbox: await inbox.status() } : {}),
        });
      } catch (error) {
        return json(503, {
          ok: false,
          service: "straylight-linear-agent",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (method === "POST" && url.pathname === "/internal/linear") {
      if (!authorizedRunner(config.runnerToken, request)) return json(401, { ok: false, message: "Unauthorized Linear broker" });
      const raw = await body(request);
      let input: { sessionId?: unknown; request?: unknown };
      try { input = JSON.parse(raw.toString("utf8")) as { sessionId?: unknown; request?: unknown }; }
      catch { return json(400, { ok: false, message: "Invalid Linear broker JSON" }); }
      if (typeof input.sessionId !== "string" || !isLinearManageRequest(input.request)) {
        return json(400, { ok: false, message: "Invalid Linear broker operation" });
      }
      server?.timeout(request, 0);
      try {
        return json(200, await controller.manageLinear(input.sessionId, input.request));
      } catch (error) {
        return json(502, { ok: false, message: finalText(error instanceof Error ? error.message : String(error)) });
      }
    }

    if (method === "POST" && url.pathname === "/internal/linear-session") {
      if (!authorizedRunner(config.runnerToken, request)) return json(401, { ok: false, message: "Unauthorized Linear collaboration broker" });
      const raw = await body(request);
      let input: { sessionId?: unknown; request?: unknown };
      try { input = JSON.parse(raw.toString("utf8")) as { sessionId?: unknown; request?: unknown }; }
      catch { return json(400, { ok: false, message: "Invalid Linear collaboration JSON" }); }
      if (typeof input.sessionId !== "string" || !isLinearSessionRequest(input.request)) {
        return json(400, { ok: false, message: "Invalid Linear collaboration request" });
      }
      server?.timeout(request, 0);
      try {
        return json(200, await controller.collaborateLinear(input.sessionId, input.request));
      } catch (error) {
        return json(502, { ok: false, message: finalText(error instanceof Error ? error.message : String(error)) });
      }
    }

    if (method === "POST" && url.pathname === "/internal/linear-upload") {
      if (!authorizedRunner(config.runnerToken, request)) return json(401, { ok: false, message: "Unauthorized Linear upload broker" });
      const raw = await body(request, MAX_LINEAR_UPLOAD_BODY_BYTES);
      let input: { sessionId?: unknown; request?: unknown };
      try { input = JSON.parse(raw.toString("utf8")) as { sessionId?: unknown; request?: unknown }; }
      catch { return json(400, { ok: false, message: "Invalid Linear upload broker JSON" }); }
      if (typeof input.sessionId !== "string" || !isLinearUploadRequest(input.request)) {
        return json(400, { ok: false, message: "Invalid Linear upload request" });
      }
      server?.timeout(request, 0);
      try {
        return json(200, { ok: true, assetUrl: await controller.uploadLinearFile(input.sessionId, input.request, request.signal) });
      } catch (error) {
        return json(502, { ok: false, message: finalText(error instanceof Error ? error.message : String(error)) });
      }
    }

    if (method === "GET" && matches(url.pathname, "/capsule/auth")) {
      return text(200, [
        "Straylight Claude workbench access",
        "",
        "Linear's button only opens these instructions. It does not receive or complete authentication.",
        "Use your normal SSH access to open the engineer's real interactive Claude CLI:",
        "",
        "  cd /home/gaby/straylight-docker",
        "  docker compose run --rm --no-deps --entrypoint claude linear-agent-claude-capsule --permission-mode auto --model sonnet",
        "",
        "Inside Claude, use its normal interactive UI (including /mcp) to connect or approve whatever service is needed.",
        "The complete /home/node profile is persistent, so Claude settings and connections survive rebuilds.",
        "When finished, exit Claude, return to Linear, and reply: resume",
        "",
      ].join("\n"));
    }

    if (method === "GET" && matches(url.pathname, "/tools/auth")) {
      return text(200, [
        "Straylight developer-tool access",
        "",
        "Linear's button opens instructions only. Credentials stay on Straylight and are never sent through Linear.",
        "SSH into Straylight, then authenticate the missing tool in the persistent workbench profile.",
        "",
        "GitHub CLI (clone, fetch, push, pull requests):",
        "",
        "  cd /home/gaby/straylight-docker",
        "  docker compose run --rm --no-deps --entrypoint gh linear-agent-runner auth login --hostname github.com --git-protocol https --web --insecure-storage",
        "  docker compose run --rm --no-deps --entrypoint gh linear-agent-runner auth setup-git",
        "  docker compose run --rm --no-deps --entrypoint gh linear-agent-runner auth status",
        "",
        "Optional web-search capacity (anonymous Exa search works without this):",
        "",
        "  install -m 600 /dev/null linear-agent/tool-profile/web-search.json",
        "  # edit that file to contain: {\"exaApiKey\":\"your-key\"}",
        "  jq empty linear-agent/tool-profile/web-search.json",
        "",
        "The profile is mounted at /tool-profile. GH_CONFIG_DIR and GIT_CONFIG_GLOBAL point there, so authentication survives task containers and image rebuilds.",
        "When finished, return to Linear and reply: resume",
        "",
      ].join("\n"));
    }

    if (method === "GET" && matches(url.pathname, "/install")) {
      if (!authorizedInstall(config.installSecret, installCredential(request, url))) {
        return text(401, "Missing or invalid install secret.\n");
      }
      return new Response(null, {
        status: 302,
        headers: { location: await linear.createInstallUrl(), ...responseHeaders },
      });
    }

    if (method === "GET" && matches(url.pathname, "/oauth/callback")) {
      const oauthError = url.searchParams.get("error");
      if (oauthError) return text(400, `Linear OAuth error: ${oauthError}\n`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return text(400, "Missing OAuth code or state.\n");
      if (!(await linear.consumeState(state))) return text(401, "Invalid or expired OAuth state.\n");
      const installation = await linear.completeInstall(code);
      console.log("Linear app installed", { appUserId: installation.appUserId, scope: installation.scope });
      return text(200, `Straylight's coding agent is installed in Linear.\nApp user: ${installation.appUserId}\nYou can close this tab.\n`);
    }

    if (method === "POST" && matches(url.pathname, "/webhook")) {
      const rawBody = await body(request);
      if (!verifyWebhookSignature(config.linearWebhookSecret, request.headers.get("linear-signature") ?? undefined, rawBody)) {
        return json(401, { ok: false, error: "invalid_signature" });
      }
      let payload: LinearWebhook;
      try {
        payload = JSON.parse(rawBody.toString("utf8")) as LinearWebhook;
      } catch {
        return json(400, { ok: false, error: "invalid_json" });
      }
      if (!freshWebhookTimestamp(payload.webhookTimestamp)) return json(401, { ok: false, error: "stale_webhook" });
      const acceptedTypes = new Set(["AgentSessionEvent", "AppUserNotification", "PermissionChange", "OAuthApp"]);
      const supported = Boolean(payload.type && acceptedTypes.has(payload.type));
      const fresh = supported ? await (inbox?.enqueue(rawBody, payload) ?? Promise.resolve(deduper.accept(rawBody))) : true;
      const accepted = supported && fresh;
      if (accepted && !inbox) setTimeout(() => { void dispatchLinearWebhook(controller, payload); }, 0);
      return json(200, { ok: true, accepted, duplicate: !fresh });
    }

    return json(404, { ok: false, error: "not_found" });
  }

}

export function dispatchLinearWebhook(controller: AgentController, payload: LinearWebhook): Promise<void> {
  switch (payload.type) {
    case "AgentSessionEvent":
      return controller.handle(payload as AgentSessionWebhook);
    case "AppUserNotification":
      return controller.handleNotification(payload as AppUserNotificationWebhook);
    case "PermissionChange":
      return controller.handlePermissionChange(payload as PermissionChangeWebhook);
    case "OAuthApp":
      return payload.action === "revoked" ? controller.handleRevocation() : Promise.resolve();
    default:
      return Promise.resolve();
  }
}
