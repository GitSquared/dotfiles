import { loadWorkbenchConfig, publicWorkbenchConfig } from "./config.js";
import { createRunnerServer } from "./runner-server.js";
import { WorkbenchHarness } from "./workbench.js";

const config = loadWorkbenchConfig(process.env);
const workbench = new WorkbenchHarness(config);
await workbench.initialize();
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: 1024 * 1024,
  fetch: createRunnerServer(workbench, config.authToken),
});
console.log("Straylight warm Pi workbench listening", publicWorkbenchConfig(config));

async function stop(signal: string): Promise<void> {
  console.log("Stopping Straylight Pi workbench", { signal });
  await workbench.shutdown();
  await server.stop();
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });
