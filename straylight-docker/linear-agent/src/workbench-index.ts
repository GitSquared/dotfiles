import { loadWorkbenchConfig, publicWorkbenchConfig } from "./config.js";
import { createRunnerServer, RUNNER_MAX_BODY_BYTES } from "./runner-server.js";
import { WorkbenchHarness } from "./workbench.js";

const config = loadWorkbenchConfig(process.env);
const workbench = new WorkbenchHarness(config);
await workbench.initialize();
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: RUNNER_MAX_BODY_BYTES,
  fetch: createRunnerServer(workbench, config.authToken),
});
console.log("Straylight warm agent workbench listening", publicWorkbenchConfig(config));

async function stop(signal: string): Promise<void> {
  console.log("Stopping Straylight agent workbench", { signal });
  await workbench.shutdown();
  await server.stop();
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });
