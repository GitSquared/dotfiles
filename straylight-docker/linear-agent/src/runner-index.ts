import { loadRunnerConfig, publicRunnerConfig } from "./config.js";
import { ClaudeHarness } from "./claude.js";
import { createRunnerServer, RUNNER_MAX_BODY_BYTES } from "./runner-server.js";

const config = loadRunnerConfig(process.env);
const runner = new ClaudeHarness(config);
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: RUNNER_MAX_BODY_BYTES,
  fetch: createRunnerServer(runner, config.authToken),
});
console.log("Straylight task runner listening", publicRunnerConfig(config));

async function stop(signal: string): Promise<void> {
  console.log("Stopping Straylight task runner", { signal });
  await server.stop();
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });
