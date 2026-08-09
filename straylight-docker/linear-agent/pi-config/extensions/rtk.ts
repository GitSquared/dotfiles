// Based on RTK v0.45.0's official Pi extension.
// Rewrites supported bash commands through the pinned rtk binary to reduce tool output.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const REWRITE_TIMEOUT_MS = 2_000;
const MIN_SUPPORTED_RTK_MINOR = 23;

function parseSemver(raw: string): [number, number, number] | null {
  const match = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function rewriteCommand(pi: ExtensionAPI, command: string, signal?: AbortSignal): Promise<string | null> {
  const result = await pi.exec("rtk", ["rewrite", command], { timeout: REWRITE_TIMEOUT_MS, signal });
  if (result.killed || (result.code !== 0 && result.code !== 3)) return null;
  return result.stdout.trim() || null;
}

export default async function rtkExtension(pi: ExtensionAPI): Promise<void> {
  const version = await pi.exec("rtk", ["--version"], { timeout: REWRITE_TIMEOUT_MS });
  if (version.code !== 0) {
    console.warn("[rtk] binary not found in PATH; output rewriting is disabled");
    return;
  }
  const parsed = parseSemver(version.stdout.replace(/^rtk\s+/, ""));
  if (parsed && parsed[0] === 0 && parsed[1] < MIN_SUPPORTED_RTK_MINOR) {
    console.warn(`[rtk] ${version.stdout.trim()} is too old; output rewriting is disabled`);
    return;
  }

  pi.on("tool_call", async (event, context) => {
    try {
      if (!isToolCallEventType("bash", event)) return;
      const command = event.input.command;
      if (typeof command !== "string" || !command.trim()) return;

      // Per-call escape hatch: `RTK_RAW=1 <command>` executes the command without rewriting.
      const raw = command.match(/^\s*RTK_RAW=1\s+([\s\S]+)$/);
      if (raw?.[1]) {
        event.input.command = raw[1];
        return;
      }
      if (command.trimStart().startsWith("rtk ") || process.env.RTK_DISABLED === "1") return;
      const rewritten = await rewriteCommand(pi, command, context.signal);
      if (rewritten && rewritten !== command) event.input.command = rewritten;
    } catch (error) {
      console.warn("[rtk] rewrite failed; passing the command through unchanged", error);
    }
  });
}
