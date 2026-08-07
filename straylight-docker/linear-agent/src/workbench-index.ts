import { loadWorkbenchConfig, publicWorkbenchConfig } from "./config.js";
import { createRunnerServer } from "./runner-server.js";
import { WorkbenchHarness } from "./workbench.js";

const config = loadWorkbenchConfig(process.env);
const workbench = new WorkbenchHarness(config);
await workbench.initialize();
const server = createRunnerServer(workbench, config.authToken);

server.listen(config.port, config.host, () => {
  console.log("Straylight disposable Pi workbench listening", publicWorkbenchConfig(config));
});

function stop(signal: string): void {
  console.log("Stopping Straylight Pi workbench", { signal });
  server.close((error) => {
    if (error) {
      console.error("Pi workbench shutdown failed", { message: error.message });
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
