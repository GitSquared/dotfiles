import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchConfig } from "../src/config.js";
import { parseRepositoryRemote, taskContainerSpec } from "../src/workbench.js";

function config(): WorkbenchConfig {
  return {
    host: "0.0.0.0",
    port: 8788,
    authToken: "r".repeat(32), // yadm-secret-scan: ignore
    dockerSocket: "/var/run/docker.sock",
    taskImage: "straylight-linear-agent-runner:local",
    taskNetwork: "straylight-linear-agent-tasks",
    hostRoot: "/srv/linear-agent",
    dataDirectory: "/workbench/data",
    workspaceRunsDirectory: "/workbench/workspace-runs",
    repositoryDirectory: "/repositories",
    workspaceInstructions: "/workbench/AGENTS.md",
    piConfigSource: "/workbench/pi-config",
    maxConcurrentTasks: 3,
    taskStartupTimeoutMs: 30_000,
    taskMemoryBytes: 4 * 1024 * 1024 * 1024,
    taskNanoCpus: 2_000_000_000,
    taskPidsLimit: 512,
  };
}

test("parses common Git repository remotes", () => {
  assert.deepEqual(parseRepositoryRemote("git@github.com:GitSquared/nemo.git", "/repositories/nemo"), {
    hostname: "github.com",
    repositoryFullName: "GitSquared/nemo",
    path: "/repositories/nemo",
  });
  assert.deepEqual(parseRepositoryRemote("https://github.com/GitSquared/dotfiles.git"), {
    hostname: "github.com",
    repositoryFullName: "GitSquared/dotfiles",
  });
  assert.equal(parseRepositoryRemote("not-a-remote"), undefined);
});

test("builds a secretless, bounded, per-session task jail", () => {
  const spec = taskContainerSpec(config(), "session-a", "task-token"); // yadm-secret-scan: ignore
  const other = taskContainerSpec(config(), "session-b", "other-token"); // yadm-secret-scan: ignore
  assert.equal(spec.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(spec.HostConfig.CapDrop, ["ALL"]);
  assert.deepEqual(spec.HostConfig.SecurityOpt, ["no-new-privileges:true"]);
  assert.equal(spec.HostConfig.NetworkMode, "straylight-linear-agent-tasks");
  assert.equal(spec.HostConfig.Memory, 4 * 1024 * 1024 * 1024);
  assert.ok(spec.HostConfig.Binds.some((bind) => bind.endsWith(":/repositories:ro")));
  assert.ok(spec.HostConfig.Binds.some((bind) => bind.endsWith(":/workspace")));
  assert.notDeepEqual(spec.HostConfig.Binds, other.HostConfig.Binds);
  assert.equal(spec.Env.some((value) => value.startsWith("LINEAR_")), false);
  assert.equal(spec.Env.some((value) => value === "PI_RUNNER_TOKEN=task-token"), true); // yadm-secret-scan: ignore
});
