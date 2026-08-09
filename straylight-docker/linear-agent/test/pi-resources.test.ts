import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { visualExplainerResourcePaths, webAccessExtensionPath } from "../src/pi-resources.js";

test("loads pinned web and visual-explainer resources headlessly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-pi-resources-"));
  try {
    const visualExplainer = visualExplainerResourcePaths();
    const loader = new DefaultResourceLoader({
      cwd: path.join(root, "workspace"),
      agentDir: path.join(root, "pi-config"),
      additionalExtensionPaths: [webAccessExtensionPath(), visualExplainer.extension],
      additionalSkillPaths: [visualExplainer.skill],
      additionalPromptTemplatePaths: [visualExplainer.prompts],
      noContextFiles: true,
    });

    await fs.mkdir(path.join(root, "workspace"), { recursive: true });
    await fs.mkdir(path.join(root, "pi-config"), { recursive: true });
    await loader.reload();

    const extensions = loader.getExtensions();
    assert.deepEqual(extensions.errors, []);
    assert.equal(extensions.extensions.some((extension) => extension.tools.has("visual_explainer")), true);

    const skills = loader.getSkills();
    assert.deepEqual(skills.diagnostics, []);
    assert.equal(skills.skills.some((skill) => skill.name === "visual-explainer"), true);

    const prompts = loader.getPrompts();
    assert.deepEqual(prompts.diagnostics, []);
    assert.equal(prompts.prompts.some((prompt) => prompt.name === "generate-web-diagram"), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
