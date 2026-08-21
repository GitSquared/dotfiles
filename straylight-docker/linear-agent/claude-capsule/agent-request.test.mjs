import assert from "node:assert/strict";
import test from "node:test";
import { assertAgentMayAct, assertTerminalSummary, createProgressProjector, createStraylightTools, recordWorkDisposition, resolveAccessRepair, runtimeBudgetInstruction, stopDispositionGuard } from "./agent-request.mjs";

test("communicates a wall-clock budget without imposing a turn ceiling", () => {
  const instruction = runtimeBudgetInstruction(3_600_000);
  assert.match(instruction, /hard wall-clock budget of 1 hour/);
  assert.match(instruction, /no turn-count limit/);
  assert.match(instruction, /runner will stop/);
});

test("projects Claude SDK reasoning and useful tool targets", async () => {
  const events = [];
  let now = 0;
  const project = createProgressProjector(async (event) => events.push(event), () => now);
  await project({ type: "system", subtype: "init", model: "claude-sonnet-5" });
  await project({ type: "stream_event", event: { type: "message_start" } });
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", name: "mcp__straylight__bash", input: {} } },
  });
  await project({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"rg -n TODO src"}' } } });
  await project({ type: "stream_event", event: { type: "content_block_stop", index: 1 } });
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tool-2", name: "mcp__straylight__manage_plan", input: {} } },
  });
  await project({ type: "stream_event", event: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"action":"replace","steps":[{"content":"Implement","status":"inProgress"},{"content":"Verify","status":"pending"}]}' } } });
  await project({ type: "stream_event", event: { type: "content_block_stop", index: 2 } });
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 3, content_block: { type: "tool_use", id: "tool-3", name: "mcp__straylight__apply_patch", input: {} } },
  });
  await project({ type: "stream_event", event: { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"directory":"carbonfact","patch":"diff"}' } } });
  await project({ type: "stream_event", event: { type: "content_block_stop", index: 3 } });
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 4, content_block: { type: "tool_use", id: "tool-4", name: "mcp__straylight__manage_linear", input: {} } },
  });
  await project({ type: "stream_event", event: { type: "content_block_delta", index: 4, delta: { type: "input_json_delta", partial_json: '{"resource":"comment","operation":"list","id":"145c7938-c834-4427-8400-74b9a82ffee5"}' } } });
  await project({ type: "stream_event", event: { type: "content_block_stop", index: 4 } });
  now = 1_000;
  await project({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private chain of thought" } } });
  now = 2_000;
  await project({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "I found the relevant module." } } });
  await project({ type: "tool_progress", tool_use_id: "tool-1", tool_name: "mcp__straylight__bash", elapsed_time_seconds: 12 });
  await project({ type: "system", subtype: "api_retry", attempt: 2, max_retries: 4, error_status: 529 });

  assert.deepEqual(events, [
    { type: "thought", body: "Claude Code connected using claude-sonnet-5; the agent turn is running." },
    { type: "action", action: "Running command", parameter: "rg -n TODO src" },
    { type: "action", action: "Updating plan", parameter: "replace · 2 steps" },
    { type: "action", action: "Applying patch", parameter: "carbonfact" },
    { type: "action", action: "Linear", parameter: "Reading comments" },
    { type: "thought", body: "Thinking: private chain of thought" },
    { type: "thought", body: "I found the relevant module." },
    { type: "action", action: "Running command", parameter: "rg -n TODO src · 12s elapsed" },
    { type: "thought", body: "Claude is retrying a model request (2/4, HTTP 529)." },
  ]);
});

test("logs a completed tool call as a durable action carrying its real result", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  await project({
    type: "stream_event",
    event: { type: "message_start" },
  });
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", name: "mcp__straylight__bash", input: {} } },
  });
  await project({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"echo hi"}' } } });
  await project({ type: "stream_event", event: { type: "content_block_stop", index: 1 } });
  // Still in flight: an elapsed-time heartbeat, folded into parameter and never a result.
  await project({ type: "tool_progress", tool_use_id: "tool-1", tool_name: "mcp__straylight__bash", elapsed_time_seconds: 3 });
  // The genuine completion: a real tool_result block for the same tool_use_id.
  await project({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "hi\n" }] },
  });

  assert.deepEqual(events, [
    { type: "action", action: "Running command", parameter: "echo hi" },
    { type: "action", action: "Running command", parameter: "echo hi · 3s elapsed" },
    { type: "action", action: "Running command", parameter: "echo hi", result: "hi" },
  ]);
});

test("extracts tool_result text from a structured content block array", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-9", name: "mcp__straylight__manage_linear", input: { operation: "get", resource: "issue" } } },
  });
  await project({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-9", content: [{ type: "text", text: "Issue ENG-1: Fix it" }] }] },
  });

  assert.deepEqual(events, [
    { type: "action", action: "Linear", parameter: "Reading the issue" },
    { type: "action", action: "Linear", parameter: "Reading the issue", result: "Issue ENG-1: Fix it" },
  ]);
});

test("never reports a tool_result for a tool_use_id this projector instance never saw start", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  // Simulates a resumed session where a prior turn's tool_use/tool_result pair
  // could otherwise resurface: this instance's tracking maps start empty, so
  // an unrecognized id must never be logged as a fresh completion.
  await project({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-from-a-prior-turn", content: "stale output" }] },
  });
  assert.deepEqual(events, []);
});

test("skips a tool_result with no extractable text instead of logging an empty durable entry", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-2", name: "mcp__straylight__view_image", input: { path: "shot.png" } } },
  });
  await project({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-2", content: [{ type: "image", source: {} }] }] },
  });
  assert.deepEqual(events, [
    { type: "action", action: "Inspecting image", parameter: "shot.png" },
  ]);
});

test("permits tools while the agent is active", () => {
  assert.doesNotThrow(() => assertAgentMayAct({ awaitingInput: false }));
});

test("freezes every further tool after blocking attention is requested", () => {
  assert.throws(
    () => assertAgentMayAct({ awaitingInput: true }),
    /blocking attention request is pending/,
  );
});

test("requires an explicit terminal disposition before Claude stops", () => {
  const context = { awaitingInput: false, attentionKind: undefined, disposition: undefined, stopRepairRequested: false };
  assert.deepEqual(stopDispositionGuard(context, { last_assistant_message: "Done." }), {
    decision: "block",
    reason: "Before stopping, choose a valid lifecycle transition: send a nonblocking signal and continue, request blocking Steering when an answer is required, request QA with evidence when work is ready for human approval, or call finish_work only for blocked_external or authorized deferred work. The agent may not declare delegated work complete.",
  });
  recordWorkDisposition(context, { status: "deferred", reason: "The issue explicitly schedules this for next week.", nextAction: "Resume next week." });
  assert.deepEqual(stopDispositionGuard(context, { last_assistant_message: "Deferred as requested." }), {});
});

test("tells the model a Signal it already sent will not be enough, instead of re-listing it as an option", () => {
  const context = {
    awaitingInput: false,
    attentionKind: undefined,
    disposition: undefined,
    stopRepairRequested: false,
    signaledSinceLastTransition: true,
  };
  const decision = stopDispositionGuard(context, { last_assistant_message: "No new work found." });
  assert.equal(decision.decision, "block");
  assert.match(decision.reason, /A Signal alone never ends a turn/);
  assert.match(decision.reason, /requesting QA again/);
});

test("rejects an informal follow-up outside the attention state machine", () => {
  const context = {
    awaitingInput: false,
    attentionKind: undefined,
    disposition: { status: "deferred", reason: "Authorized pause.", nextAction: "Resume next week." },
    stopRepairRequested: true,
  };
  assert.throws(() => assertTerminalSummary(context, "All good; let me know if you want more."), /outside the Linear attention state machine/);
});

test("repairs a prose blocker that lacks an active Linear attention request", () => {
  const context = {
    awaitingInput: false,
    attentionKind: undefined,
    disposition: { status: "blocked_external", reason: "Repository unavailable." },
    stopRepairRequested: false,
  };
  const decision = stopDispositionGuard(context, {
    last_assistant_message: "I cannot continue until the engineer grants repository access.",
  });
  assert.equal(decision.decision, "block");
  assert.match(decision.reason, /no blocking attention request is active/);
});

test("only request_attention can record a human-owned transition", () => {
  assert.throws(
    () => recordWorkDisposition({ awaitingInput: false }, { status: "awaiting_steering", reason: "Need access." }),
    /must use request_attention/,
  );
});

test("resolves missing developer-tool or capsule access to the workbench's configured auth URL", () => {
  const context = {
    capsuleAuthUrl: "https://straylight.example.test/linear/capsule/auth",
    toolAuthUrl: "https://straylight.example.test/linear/tools/auth",
  };
  assert.deepEqual(resolveAccessRepair({ workspace: "tools", providerName: "GitHub" }, context), {
    url: "https://straylight.example.test/linear/tools/auth",
    providerName: "GitHub",
  });
  assert.deepEqual(resolveAccessRepair({ workspace: "capsule", providerName: "Claude" }, context), {
    url: "https://straylight.example.test/linear/capsule/auth",
    providerName: "Claude",
  });
  assert.equal(resolveAccessRepair(undefined, context), undefined);
});

test("refuses to resolve access repair when the workbench has no configured auth URL", () => {
  assert.throws(
    () => resolveAccessRepair({ workspace: "tools", providerName: "GitHub" }, {}),
    /No tools auth URL is configured/,
  );
});

// The tests below exercise the real request_attention tool call, not just the
// pure resolveAccessRepair helper: createStraylightTools(context) returns the
// { type: "sdk", instance } wrapper createSdkMcpServer hands to the SDK, and
// the SDK registers each tool()'s handler verbatim onto
// instance._registeredTools[name].handler (see
// @anthropic-ai/claude-agent-sdk's createSdkMcpServer, which forwards straight
// into @modelcontextprotocol/sdk's McpServer.registerTool). Reaching into
// that registry is the only way to invoke the actual destructuring/guard/
// spread logic inside the request_attention handler, as opposed to a
// hand-rolled stand-in for it.
function accessRepairWorkbenchContext() {
  return {
    workbenchUrl: "https://workbench.example.test",
    taskToken: "task-token",
    capsuleAuthUrl: "https://workbench.example.test/capsule/auth",
    toolAuthUrl: "https://workbench.example.test/tools/auth",
    awaitingInput: false,
    disposition: undefined,
  };
}

function requestAttentionHandler(context) {
  const { instance } = createStraylightTools(context);
  return instance._registeredTools.request_attention.handler;
}

function baseAttentionRequest(overrides) {
  return {
    delivery: "interrupt",
    title: "Push blocked",
    action: "Push the branch.",
    recommendation: "Link GitHub access.",
    ...overrides,
  };
}

test("the request_attention tool call rejects missingAccess on a non-blocking Signal or a QA request", async (t) => {
  const context = accessRepairWorkbenchContext();
  const fetchCalls = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    fetchCalls.push(args);
    throw new Error("fetch should not be called when missingAccess is rejected");
  });
  const handler = requestAttentionHandler(context);

  for (const kind of ["signal", "qa"]) {
    await assert.rejects(
      () => handler(baseAttentionRequest({ kind, missingAccess: { workspace: "tools", providerName: "GitHub" } }), {}),
      /missingAccess requires kind: steering/,
    );
  }
  assert.equal(fetchCalls.length, 0);
});

test("the request_attention tool call assembles a correctly-populated accessRepair onto the forwarded attention for a blocking Steering request", async (t) => {
  const context = accessRepairWorkbenchContext();
  const missingAccess = { workspace: "tools", providerName: "GitHub" };
  const expectedAccessRepair = resolveAccessRepair(missingAccess, context);

  let capturedUrl;
  let capturedBody;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ ok: true }) };
  });
  const handler = requestAttentionHandler(context);

  await handler(baseAttentionRequest({ kind: "steering", missingAccess }), {});

  assert.equal(capturedUrl, "https://workbench.example.test/v1/linear-session");
  assert.equal("missingAccess" in capturedBody.request, false);
  assert.deepEqual(capturedBody.request.accessRepair, expectedAccessRepair);
  assert.deepEqual(capturedBody.request.accessRepair, { url: "https://workbench.example.test/tools/auth", providerName: "GitHub" });
});

// linear_activity has no per-action logic of its own - unlike request_attention
// it just forwards whatever { request } shape it was called with straight to
// the workbench (the real validation lives server-side in isLinearSessionRequest/
// AgentController.collaborateLinear). This still earns its own test: it is the
// only thing that proves a new action like "react" reaches the wire unmodified,
// through the same _registeredTools reflection used for request_attention above.
function linearActivityHandler(context) {
  const { instance } = createStraylightTools(context);
  return instance._registeredTools.linear_activity.handler;
}

test("the linear_activity tool call forwards a react request verbatim to the workbench", async (t) => {
  const context = accessRepairWorkbenchContext();
  let capturedUrl;
  let capturedBody;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ ok: true, action: "react" }) };
  });
  const handler = linearActivityHandler(context);

  const result = await handler({ request: { action: "react", commentId: "comment-42", emoji: "white_check_mark" } }, {});

  assert.equal(capturedUrl, "https://workbench.example.test/v1/linear-session");
  assert.deepEqual(capturedBody, { action: "react", commentId: "comment-42", emoji: "white_check_mark" });
  assert.deepEqual(result, { content: [{ type: "text", text: JSON.stringify({ ok: true, action: "react" }, null, 2) }] });
});
