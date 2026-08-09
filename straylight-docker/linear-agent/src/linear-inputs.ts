import path from "node:path";
import type { AgentSessionWebhook, LinearInputFile } from "./types.js";

export const MAX_LINEAR_INPUTS = 8;
export const MAX_LINEAR_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_LINEAR_INPUT_TOTAL_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/typescript",
  "text/xml",
  "text/yaml",
  "application/json",
  "application/pdf",
  "application/xml",
  "application/yaml",
  "application/zip",
  "application/gzip",
  "application/octet-stream",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function allowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType) || (mimeType.startsWith("text/") && mimeType !== "text/event-stream");
}

export type LinearInputReference = { url: string; label?: string };
export type LinearInputDownload = {
  inputs: LinearInputFile[];
  skipped: Array<{ label: string; reason: string }>;
  totalBytes: number;
};

function sourceTexts(payload: AgentSessionWebhook): string[] {
  return [
    payload.promptContext,
    payload.agentSession?.promptContext,
    payload.agentSession?.issue?.description,
    payload.agentSession?.comment?.body,
    payload.agentActivity?.content?.body,
    ...(payload.previousComments?.map((comment) => comment.body) ?? []),
  ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

function isLinearUploadUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:"
      && url.hostname === "uploads.linear.app"
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function linearInputReferences(payload: AgentSessionWebhook): LinearInputReference[] {
  const found = new Map<string, LinearInputReference>();
  for (const text of sourceTexts(payload)) {
    const markdown = /!?\[([^\]]*)\]\((https:\/\/uploads\.linear\.app\/[^\s)]+)(?:\s+["'][^)]*["'])?\)/gi;
    for (const match of text.matchAll(markdown)) {
      const url = match[2];
      if (!url || !isLinearUploadUrl(url) || found.has(url)) continue;
      const label = match[1]?.trim();
      found.set(url, { url, ...(label ? { label } : {}) });
    }
    const bare = /https:\/\/uploads\.linear\.app\/[^\s<>"')\]]+/gi;
    for (const match of text.matchAll(bare)) {
      const url = match[0]?.replace(/[.,;:!?]+$/, "");
      if (!url || !isLinearUploadUrl(url) || found.has(url)) continue;
      found.set(url, { url });
    }
  }
  return [...found.values()].slice(0, MAX_LINEAR_INPUTS);
}

function contentDispositionFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, "")); }
    catch { return undefined; }
  }
  return value.match(/filename="([^"]+)"/i)?.[1] ?? value.match(/filename=([^;]+)/i)?.[1]?.trim();
}

function safeFilename(reference: LinearInputReference, response: Response, index: number): string {
  const fromHeader = contentDispositionFilename(response.headers.get("content-disposition"));
  let fromPath = "";
  try { fromPath = decodeURIComponent(path.basename(new URL(reference.url).pathname)); }
  catch { fromPath = ""; }
  const candidate = fromHeader || reference.label || fromPath || `linear-input-${index + 1}`;
  const safe = path.basename(candidate).replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").slice(0, 180);
  return safe || `linear-input-${index + 1}`;
}

function validImageSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "image/png") return bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (mimeType === "image/gif") return Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF87a" || Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF89a";
  if (mimeType === "image/webp") return Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  return true;
}

export function decodeLinearInput(input: LinearInputFile): Buffer {
  if (!input || typeof input !== "object" || typeof input.dataBase64 !== "string") throw new Error("Linear input payload is invalid");
  if (typeof input.filename !== "string" || !input.filename || typeof input.mimeType !== "string" || !allowedMimeType(input.mimeType)) {
    throw new Error("Linear input metadata is invalid");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)) throw new Error("Linear input is not valid base64");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length || bytes.length !== input.size || bytes.length > MAX_LINEAR_INPUT_BYTES) throw new Error("Linear input size is invalid");
  if (input.mimeType.startsWith("image/") && !validImageSignature(input.mimeType, bytes)) throw new Error(`invalid ${input.mimeType} signature`);
  return bytes;
}

async function boundedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("empty response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_LINEAR_INPUT_BYTES) {
      await reader.cancel();
      throw new Error(`file exceeds ${MAX_LINEAR_INPUT_BYTES} bytes`);
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadLinearInputs(
  payload: AgentSessionWebhook,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<LinearInputDownload> {
  const inputs: LinearInputFile[] = [];
  const skipped: LinearInputDownload["skipped"] = [];
  let totalBytes = 0;
  const references = linearInputReferences(payload);
  for (const [index, reference] of references.entries()) {
    const label = reference.label || `Linear input ${index + 1}`;
    try {
      if (!isLinearUploadUrl(reference.url)) throw new Error("URL is not authenticated Linear file storage");
      const response = await fetcher(reference.url, {
        headers: { authorization: `Bearer ${accessToken}` },
        redirect: "error",
      });
      if (!response.ok) throw new Error(`download returned HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > MAX_LINEAR_INPUT_BYTES) throw new Error(`file exceeds ${MAX_LINEAR_INPUT_BYTES} bytes`);
      const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!allowedMimeType(mimeType)) throw new Error(`unsupported content type ${mimeType || "unknown"}`);
      const bytes = await boundedBody(response);
      if (!bytes.length) throw new Error("file is empty");
      if (totalBytes + bytes.byteLength > MAX_LINEAR_INPUT_TOTAL_BYTES) throw new Error("combined Linear inputs exceed the total byte limit");
      if (mimeType.startsWith("image/") && !validImageSignature(mimeType, bytes)) throw new Error(`invalid ${mimeType} signature`);
      const filename = safeFilename(reference, response, index);
      inputs.push({ filename, mimeType, size: bytes.byteLength, dataBase64: Buffer.from(bytes).toString("base64") });
      totalBytes += bytes.byteLength;
    } catch (error) {
      skipped.push({ label: label.slice(0, 180), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { inputs, skipped, totalBytes };
}
