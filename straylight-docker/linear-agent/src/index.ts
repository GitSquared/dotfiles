import { loadConfig, publicConfig } from "./config.js";
import { AgentController } from "./controller.js";
import { LinearClient } from "./linear.js";
import { PiHarness } from "./pi.js";
import { createServer } from "./server.js";

const config = loadConfig(process.env);
const linear = new LinearClient(config);
const pi = new PiHarness(config);
const controller = new AgentController(linear, pi);
const server = createServer(config, linear, controller);

server.listen(config.port, config.host, () => {
  console.log("Straylight Linear agent listening", publicConfig(config));
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
