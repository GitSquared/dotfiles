import fs from "node:fs/promises";
import path from "node:path";
import { CapsuleClient } from "./capsule-client.js";
import type { RunnerConfig } from "./config.js";
import { LinearToolClient } from "./linear-tool-client.js";
import { materializeLinearInputs } from "./pi.js";
import { ProgressReporter } from "./progress.js";
import { claudeFollowUpPrompt, claudeInitialPrompt } from "./prompts.js";
import { finalText, progressText, redact } from "./redaction.js";
import type { PiResult, RunnerEvent } from "./runner-protocol.js";
import { captureCommand } from "./runtime.js";
import type { AgentTaskPayload, LinearInputFile, RepositoryCandidate } from "./types.js";

type Sender = (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>;
type SessionFile = { linearSessionId: string; claudeSessionId: string; updatedAt: string };

export class ClaudeHarness {
  private readonly capsule: Pick<CapsuleClient, "runBrokeredAgent">;
  private readonly linear: Pick<LinearToolClient, "upload" | "collaborate">;
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly config: RunnerConfig,
    capsule?: Pick<CapsuleClient, "runBrokeredAgent">,
    linear?: Pick<LinearToolClient, "upload" | "collaborate">,
  ) {
    this.capsule = capsule ?? new CapsuleClient(config.capsuleUrl, config.authToken);
    this.linear = linear ?? new LinearToolClient(config.workbenchUrl, config.authToken);
  }

  async run(payload: AgentTaskPayload, send: Sender): Promise<PiResult> {
    const sessionId = payload.agentSession?.id;
    if (!sessionId) throw new Error("agentSession.id is required");
    if (this.active.has(sessionId)) throw new Error("this Claude session is already running");
    const startedAt = performance.now();
    const reporter = new ProgressReporter(send, this.config.progressDebounceMs, this.config.progressHeartbeatMs);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.piTimeoutMs);
    timeout.unref();
    this.active.set(sessionId, controller);
    try {
      reporter.start();
      reporter.report({
        type: "activity",
        content: { type: "thought", body: "Claude Code is starting in the isolated Straylight workspace." },
        ephemeral: true,
      });
      await reporter.flush();
      const linearInputs = await materializeLinearInputs(this.config.piWorkdir, payload.linearInputs);
      const basePrompt = payload.action === "prompted" ? claudeFollowUpPrompt(payload) : claudeInitialPrompt(payload);
      const prompt = `${basePrompt}${linearInputs.prompt}`;
      const resume = await this.readSession(sessionId);
      const result = await this.capsule.runBrokeredAgent({
        prompt,
        ...(resume ? { resume } : {}),
        model: "sonnet",
        timeBudgetMs: this.config.piTimeoutMs,
      }, controller.signal, (progress) => {
        reporter.report({
          type: "activity",
          content: progress.type === "thought"
            ? { type: "thought", body: finalText(progress.body) }
            : {
                type: "action",
                action: progressText(progress.action),
                parameter: progressText(progress.parameter),
                ...(progress.result ? { result: progressText(progress.result) } : {}),
              },
          ephemeral: true,
        });
      });
      if (timedOut) {
        return {
          ok: false,
          timedOut: true,
          awaitingInput: false,
          summary: finalText(timeoutSummary(this.config.piTimeoutMs)),
          elapsedMs: Math.round(performance.now() - startedAt),
        };
      }
      if (result.status === "error") {
        if (result.sessionId) await this.writeSession(sessionId, result.sessionId);
        return {
          ok: false,
          timedOut: false,
          awaitingInput: false,
          summary: finalText(result.message),
          elapsedMs: Math.round(performance.now() - startedAt),
        };
      }
      await this.writeSession(sessionId, result.sessionId);
      const awaitingInput = ["awaiting_steering", "awaiting_qa"].includes(result.disposition.status);
      if (result.awaitingInput !== awaitingInput) {
        throw new Error("Claude attention state conflicts with its terminal work disposition");
      }
      return {
        ok: awaitingInput,
        timedOut: false,
        awaitingInput,
        summary: finalText(result.answer || "Claude Code ended the turn without a textual summary."),
        elapsedMs: result.durationMs || Math.round(performance.now() - startedAt),
        disposition: result.disposition,
      };
    } catch (error) {
      const aborted = controller.signal.aborted;
      return {
        ok: false,
        timedOut,
        awaitingInput: false,
        summary: finalText(timedOut
          ? timeoutSummary(this.config.piTimeoutMs)
          : aborted
            ? "Stopped by user."
            : (error instanceof Error ? error.message : String(error))),
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      clearTimeout(timeout);
      await reporter.flush();
      reporter.stop();
      this.active.delete(sessionId);
    }
  }

  async followUp(_sessionId: string, _prompt: string, _inputs?: LinearInputFile[]): Promise<boolean> {
    // Claude's print-mode turn is not bidirectional. The controller queues this
    // follow-up and resumes the same persisted Claude conversation next turn.
    return false;
  }

  async abort(sessionId: string): Promise<boolean> {
    const active = this.active.get(sessionId);
    if (!active) return false;
    active.abort();
    return true;
  }

  repositories(): Promise<RepositoryCandidate[]> {
    return Promise.resolve([]);
  }

  health(): Promise<Record<string, unknown>> {
    return Promise.resolve({ backend: "claude-code", activeSessions: this.active.size, model: "sonnet" });
  }

  async shell(
    request: { command: string; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }> {
    const timeout = Math.max(1_000, Math.min(request.timeoutMs ?? 120_000, 300_000));
    const environment = { ...process.env };
    for (const name of [
      "PI_RUNNER_TOKEN",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CAPSULE_CONTROL_TOKEN",
    ]) delete environment[name];
    const result = await captureCommand("bash", ["-lc", request.command], {
      cwd: this.config.piWorkdir,
      env: environment,
      timeout,
      maxBuffer: 256 * 1024,
      ...(signal ? { signal } : {}),
    });
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: redact(result.stdout).slice(-128 * 1024),
      stderr: redact(result.stderr).slice(-128 * 1024),
    };
  }

  async shareArtifact(
    request: { path: string; title?: string; body?: string },
    signal?: AbortSignal,
  ): Promise<{ ok: true; assetUrl: string; contentType: string; filename: string }> {
    const artifact = await workspaceArtifact(this.config.piWorkdir, request.path);
    const contentType = artifactMimeType(artifact.filename);
    const assetUrl = await this.linear.upload(artifact.filename, contentType, artifact.data, signal);
    const label = finalText(request.title || artifact.filename).replace(/[\[\]]/g, "").slice(0, 200);
    const link = contentType.startsWith("image/")
      ? `![${label}](${assetUrl})`
      : `[${label}](${assetUrl})`;
    await this.linear.collaborate({
      action: "activity",
      content: {
        type: "thought",
        body: [request.body ? finalText(request.body) : "", link].filter(Boolean).join("\n\n"),
      },
    }, signal);
    return { ok: true, assetUrl, contentType, filename: artifact.filename };
  }

  async viewImage(request: { path: string }): Promise<{ ok: true; dataBase64: string; mimeType: string }> {
    const image = await workspaceArtifact(this.config.piWorkdir, request.path);
    const mimeType = artifactMimeType(image.filename);
    if (!(["image/png", "image/jpeg", "image/gif", "image/webp"] as string[]).includes(mimeType)) {
      throw new Error("Image viewing supports PNG, JPEG, GIF, and WebP files");
    }
    if (image.data.length > 5 * 1024 * 1024) throw new Error("Images viewed by Claude are limited to 5 MB");
    if (!matchesImageSignature(mimeType, image.data)) throw new Error("Image contents do not match the filename type");
    return { ok: true, dataBase64: image.data.toString("base64"), mimeType };
  }

  private sessionFilename(): string {
    return path.join(this.config.piWorkdir, ".straylight", "claude-session.json");
  }

  private async readSession(linearSessionId: string): Promise<string | undefined> {
    try {
      const value = JSON.parse(await fs.readFile(this.sessionFilename(), "utf8")) as Partial<SessionFile>;
      return value.linearSessionId === linearSessionId && typeof value.claudeSessionId === "string"
        ? value.claudeSessionId
        : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async writeSession(linearSessionId: string, claudeSessionId: string): Promise<void> {
    const filename = this.sessionFilename();
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({
      linearSessionId,
      claudeSessionId,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, filename);
  }
}

function timeoutSummary(timeoutMs: number): string {
  if (timeoutMs < 1_000) return `Claude Code run timed out after ${timeoutMs} milliseconds.`;
  if (timeoutMs < 60_000) {
    const seconds = Math.round(timeoutMs / 1_000);
    return `Claude Code run timed out after ${seconds} second${seconds === 1 ? "" : "s"}.`;
  }
  const minutes = Math.round(timeoutMs / 60_000);
  return `Claude Code run timed out after ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

function artifactMimeType(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".md": return "text/markdown";
    case ".txt": return "text/plain";
    case ".pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

function matchesImageSignature(mimeType: string, data: Buffer): boolean {
  if (mimeType === "image/png") return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/jpeg") return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"));
  return mimeType === "image/webp"
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP";
}

async function workspaceArtifact(workdir: string, filename: string): Promise<{ data: Buffer; filename: string }> {
  const root = await fs.realpath(workdir);
  const resolved = await fs.realpath(path.resolve(workdir, filename));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Review artifacts must be regular files inside /workspace");
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("Review artifact is not a regular file");
  if (!stat.size || stat.size > 10 * 1024 * 1024) throw new Error("Review artifacts must be between 1 byte and 10 MB");
  return { data: await fs.readFile(resolved), filename: path.basename(resolved) };
}
