import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { ControllerConfig } from "./config.js";
import { AgentController } from "./controller.js";
import { LinearClient } from "./linear.js";
import { DeliveryDeduper, freshWebhookTimestamp, verifyWebhookSignature } from "./signature.js";
import type { AgentSessionWebhook } from "./types.js";

const MAX_BODY_BYTES = 1024 * 1024;

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function text(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function installCredential(request: IncomingMessage, url: URL): string | undefined {
  const authorization = header(request, "authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  return url.searchParams.get("install_secret") ?? undefined;
}

function authorizedInstall(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && crypto.timingSafeEqual(expectedBytes, providedBytes);
}

function matches(pathname: string, route: string): boolean {
  return pathname === `/linear${route}` || pathname === route;
}

export function createServer(config: ControllerConfig, linear: LinearClient, controller: AgentController): http.Server {
  const deduper = new DeliveryDeduper();
  return http.createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("request failed", { message });
      if (!response.headersSent) json(response, message === "request_too_large" ? 413 : 500, { ok: false, error: "internal_error" });
      else response.end();
    });
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", config.baseUrl);

    if (method === "GET" && url.pathname === "/healthz") {
      json(response, 200, { ok: true, service: "straylight-linear-agent" });
      return;
    }

    if (method === "GET" && matches(url.pathname, "/install")) {
      if (!authorizedInstall(config.installSecret, installCredential(request, url))) {
        text(response, 401, "Missing or invalid install secret.\n");
        return;
      }
      response.writeHead(302, { location: await linear.createInstallUrl(), "cache-control": "no-store" });
      response.end();
      return;
    }

    if (method === "GET" && matches(url.pathname, "/oauth/callback")) {
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        text(response, 400, `Linear OAuth error: ${oauthError}\n`);
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        text(response, 400, "Missing OAuth code or state.\n");
        return;
      }
      if (!(await linear.consumeState(state))) {
        text(response, 401, "Invalid or expired OAuth state.\n");
        return;
      }
      const installation = await linear.completeInstall(code);
      console.log("Linear app installed", { appUserId: installation.appUserId, scope: installation.scope });
      text(response, 200, `Straylight's Pi agent is installed in Linear.\nApp user: ${installation.appUserId}\nYou can close this tab.\n`);
      return;
    }

    if (method === "POST" && matches(url.pathname, "/webhook")) {
      const rawBody = await body(request);
      if (!verifyWebhookSignature(config.linearWebhookSecret, header(request, "linear-signature"), rawBody)) {
        json(response, 401, { ok: false, error: "invalid_signature" });
        return;
      }
      let payload: AgentSessionWebhook;
      try {
        payload = JSON.parse(rawBody.toString("utf8")) as AgentSessionWebhook;
      } catch {
        json(response, 400, { ok: false, error: "invalid_json" });
        return;
      }
      if (!freshWebhookTimestamp(payload.webhookTimestamp)) {
        json(response, 401, { ok: false, error: "stale_webhook" });
        return;
      }
      const fresh = deduper.accept(rawBody);
      const accepted = fresh && payload.type === "AgentSessionEvent";
      json(response, 200, { ok: true, accepted, duplicate: !fresh });
      if (accepted) {
        setImmediate(() => void controller.handle(payload).catch((error: unknown) => {
          console.error("Agent Session handler failed", { message: error instanceof Error ? error.message : String(error) });
        }));
      }
      return;
    }

    json(response, 404, { ok: false, error: "not_found" });
  }
}
