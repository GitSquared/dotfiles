import { loadControllerConfig, publicControllerConfig } from "./config.js";
import { AgentController } from "./controller.js";
import { LinearClient } from "./linear.js";
import { PiRunnerClient } from "./runner-client.js";
import { createServer, dispatchLinearWebhook, MAX_LINEAR_UPLOAD_BODY_BYTES } from "./server.js";
import { DurableWebhookInbox } from "./webhook-inbox.js";

const config = loadControllerConfig(process.env);
const linear = new LinearClient(config);
const runner = new PiRunnerClient(config.runnerUrl, config.runnerToken);
const controller = new AgentController(linear, runner, config.stateDirectory);
await controller.initialize();
const inbox = new DurableWebhookInbox(config.stateDirectory, (payload) => dispatchLinearWebhook(controller, payload));
await inbox.initialize();
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: MAX_LINEAR_UPLOAD_BODY_BYTES,
  fetch: createServer(config, linear, controller, inbox),
});
console.log("Straylight Linear controller listening", publicControllerConfig(config));

async function stop(signal: string): Promise<void> {
  console.log("Stopping Straylight Linear agent", { signal });
  inbox.shutdown();
  await server.stop();
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });
