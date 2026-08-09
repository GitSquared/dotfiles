import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export function webAccessExtensionPath(): string {
  return path.join(path.dirname(require.resolve("pi-web-access/package.json")), "index.ts");
}

export function visualExplainerResourcePaths(): {
  extension: string;
  skill: string;
  prompts: string;
} {
  const root = path.dirname(require.resolve("visual-explainer/package.json"));
  const plugin = path.join(root, "plugins", "visual-explainer");
  return {
    extension: path.join(plugin, "extension.ts"),
    skill: plugin,
    prompts: path.join(plugin, "commands"),
  };
}
