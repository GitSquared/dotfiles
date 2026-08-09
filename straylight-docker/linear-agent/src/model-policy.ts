import fs from "node:fs/promises";
import path from "node:path";

export const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type PolicyThinkingLevel = typeof THINKING_LEVELS[number];

export type AllowedModel = {
  name: string;
  provider: string;
  model: string;
  thinking: PolicyThinkingLevel;
  description: string;
};

export type ModelPolicy = {
  classifier: { provider: string; model: string; thinking: PolicyThinkingLevel };
  fallback: string;
  models: AllowedModel[];
};

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function thinking(value: unknown, label: string): PolicyThinkingLevel {
  if (typeof value !== "string" || !(THINKING_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`${label} must be one of ${THINKING_LEVELS.join(", ")}`);
  }
  return value as PolicyThinkingLevel;
}

export function parseModelPolicy(value: unknown): ModelPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("model policy must be a JSON object");
  const object = value as Record<string, unknown>;
  if (!object.classifier || typeof object.classifier !== "object" || Array.isArray(object.classifier)) {
    throw new Error("model policy classifier must be an object");
  }
  const classifier = object.classifier as Record<string, unknown>;
  if (!Array.isArray(object.models) || !object.models.length) throw new Error("model policy models must be a non-empty array");
  const models = object.models.map((entry, index): AllowedModel => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`model policy models[${index}] must be an object`);
    const item = entry as Record<string, unknown>;
    return {
      name: nonempty(item.name, `models[${index}].name`).toLowerCase(),
      provider: nonempty(item.provider, `models[${index}].provider`),
      model: nonempty(item.model, `models[${index}].model`),
      thinking: thinking(item.thinking, `models[${index}].thinking`),
      description: nonempty(item.description, `models[${index}].description`),
    };
  });
  const names = new Set(models.map((model) => model.name));
  if (names.size !== models.length) throw new Error("model policy model names must be unique");
  const fallback = nonempty(object.fallback, "model policy fallback").toLowerCase();
  if (!names.has(fallback)) throw new Error(`model policy fallback ${fallback} is not in the allowlist`);
  return {
    classifier: {
      provider: nonempty(classifier.provider, "classifier.provider"),
      model: nonempty(classifier.model, "classifier.model"),
      thinking: thinking(classifier.thinking, "classifier.thinking"),
    },
    fallback,
    models,
  };
}

export async function loadModelPolicy(agentDirectory: string): Promise<ModelPolicy> {
  const filename = path.join(agentDirectory, "model-policy.json");
  let parsed: unknown;
  try { parsed = JSON.parse(await fs.readFile(filename, "utf8")) as unknown; }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${filename}: ${error.message}`);
    throw error;
  }
  return parseModelPolicy(parsed);
}

export function selectedModelName(text: string, policy: ModelPolicy): string | undefined {
  const normalized = text.trim().toLowerCase();
  try {
    const object = JSON.parse(normalized.match(/\{[\s\S]*\}/)?.[0] ?? normalized) as { model?: unknown };
    const name = object.model;
    if (typeof name === "string" && policy.models.some((model) => model.name === name.toLowerCase())) {
      return name.toLowerCase();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function publicModelPolicy(policy: ModelPolicy): Record<string, unknown> {
  return {
    classifier: `${policy.classifier.provider}/${policy.classifier.model}:${policy.classifier.thinking}`,
    fallback: policy.fallback,
    allowlist: policy.models.map((model) => ({
      name: model.name,
      model: `${model.provider}/${model.model}`,
      thinking: model.thinking,
    })),
  };
}
