import { loadControllerConfig, publicControllerConfig } from "./config.js";
import { AgentController } from "./controller.js";
import { LinearClient } from "./linear.js";
import { PiRunnerClient } from "./runner-client.js";
import { createServer } from "./server.js";

const config = loadControllerConfig(process.env);
const linear = new LinearClient(config);
const runner = new PiRunnerClient(config.runnerUrl);
const controller = new AgentController(linear, runner);
const server = createServer(config, linear, controller);

server.listen(config.port, config.host, () => {
  console.log("Straylight Linear controller listening", publicControllerConfig(config));
});

function stop(signal: string): void {
  console.log("Stopping Straylight Linear agent", { signal });
  server.close((error) => {
    if (error) {
      console.error("HTTP server shutdown failed", { message: error.message });
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
