import { loadControllerConfig, publicControllerConfig } from "./config.js";
import { AgentController } from "./controller.js";
import { LinearClient } from "./linear.js";
import { PiRunnerClient } from "./runner-client.js";
import { createServer } from "./server.js";
import { PersistentDeliveryDeduper } from "./signature.js";

const config = loadControllerConfig(process.env);
const linear = new LinearClient(config);
const runner = new PiRunnerClient(config.runnerUrl, config.runnerToken);
const controller = new AgentController(linear, runner, config.stateDirectory);
await controller.initialize();
const deduper = new PersistentDeliveryDeduper(config.stateDirectory);
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: 1024 * 1024,
  fetch: createServer(config, linear, controller, deduper),
});
console.log("Straylight Linear controller listening", publicControllerConfig(config));

async function stop(signal: string): Promise<void> {
  console.log("Stopping Straylight Linear agent", { signal });
  await server.stop();
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });
