import assert from "node:assert/strict";
import test from "node:test";
import { assertAgentMayAct, assertTerminalSummary, createInjector, createInputQueue, createProgressProjector, createStraylightTools, recordWorkDisposition, resolveAccessRepair, runtimeBudgetInstruction, stopDispositionGuard, synthesizeRateLimitDisposition } from "./agent-request.mjs";

test("communicates an inactivity budget without imposing a turn ceiling", () => {
  const instruction = runtimeBudgetInstruction(3_600_000);
  assert.match(instruction, /inactivity budget of 1 hour/);
  assert.match(instruction, /no turn-count limit/);
  assert.match(instruction, /resets the clock/);
  assert.match(instruction, /runner stops the process/);
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
    { type: "response", body: "I found the relevant module." },
    { type: "action", action: "Running command", parameter: "rg -n TODO src · 12s elapsed" },
    { type: "thought", body: "Claude is retrying a model request (2/4, HTTP 529)." },
  ]);
});

test("reports the model's own composed narration as a real message, not an internal note", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  // A short final assistant turn: too little text to cross the streamed text_delta
  // debounce threshold, so the only progress event comes from the "assistant"
  // message's own final-flush path, not the streaming one covered above.
  await project({ type: "stream_event", event: { type: "message_start" } });
  await project({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "Network access is available." }] },
  });

  assert.deepEqual(events, [{ type: "response", body: "Network access is available." }]);
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

test("folds a repository hoist request into a durable, readable action", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", name: "mcp__straylight__hoist_repository", input: {} } },
  });
  await project({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"hostname":"github.com","repositoryFullName":"GitSquared/dotfiles"}' } } });
  await project({ type: "stream_event", event: { type: "content_block_stop", index: 1 } });

  assert.deepEqual(events, [
    { type: "action", action: "Hoisting repository into shared cache", parameter: "github.com/GitSquared/dotfiles" },
  ]);
});

test("folds a non-default working directory into the durable bash action instead of a cd prefix", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", name: "mcp__straylight__bash", input: {} } },
  });
  await project({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"npm test","directory":"carbonfact"}' } } });
  await project({ type: "stream_event", event: { type: "content_block_stop", index: 1 } });

  assert.deepEqual(events, [
    { type: "action", action: "Running command", parameter: "npm test (in carbonfact)" },
  ]);
});

test("marks a failed tool call's durable action so it reads differently from a success", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", name: "mcp__straylight__bash", input: { command: "false" } } },
  });
  // A failing bash command: the SDK reports it as a tool_result with is_error: true, the
  // real stderr/exit-status text still present in content - the same shape a successful
  // call has, aside from that flag.
  await project({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", is_error: true, content: "command exited with code 1" }] },
  });

  assert.deepEqual(events, [
    { type: "action", action: "Running command", parameter: "false" },
    { type: "action", action: "Failed: Running command", parameter: "false", result: "command exited with code 1" },
  ]);
});

test("still logs a failed tool call durably even when the error itself carried no extractable text", async () => {
  const events = [];
  const project = createProgressProjector(async (event) => events.push(event));
  await project({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-2", name: "mcp__straylight__apply_patch", input: { directory: "carbonfact" } } },
  });
  // An is_error result with nothing extractable as text (e.g. a thrown Error with an empty
  // message): must not be skipped the way a genuinely empty *success* is - skipping here
  // would hide the loudest signal a human scanning the durable log needs.
  await project({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-2", is_error: true, content: [] }] },
  });

  assert.deepEqual(events, [
    { type: "action", action: "Applying patch", parameter: "carbonfact" },
    { type: "action", action: "Failed: Applying patch", parameter: "carbonfact", result: "(no output)" },
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
    reason: "Before stopping, choose a valid lifecycle transition: send a nonblocking signal and continue, request blocking Steering when an answer is required, request QA with evidence when a deliverable is ready for human approval, or call finish_work - answered for a purely conversational reply you already gave with nothing to approve, blocked_external for a non-human dependency, or deferred when authorized. The agent may not declare work with a real deliverable complete on its own.",
  });
  recordWorkDisposition(context, { status: "deferred", reason: "The issue explicitly schedules this for next week.", nextAction: "Resume next week." });
  assert.deepEqual(stopDispositionGuard(context, { last_assistant_message: "Deferred as requested." }), {});
});

// GAB-30 regression: a plain answered question got dressed up as a full QA report card.
// finish_work's third status closes a purely conversational turn without QA's evidence
// requirement or a manufactured Steering/QA card, and without a nextAction (nothing is next).
test("closes a purely conversational turn with finish_work's answered status, no nextAction required", () => {
  const context = { awaitingInput: false, attentionKind: undefined, disposition: undefined, stopRepairRequested: false };
  recordWorkDisposition(context, { status: "answered", reason: "Confirmed the report already covers that scope item." });
  assert.equal(context.disposition.status, "answered");
  assert.deepEqual(stopDispositionGuard(context, { last_assistant_message: "Confirmed the report already covers that scope item." }), {});
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

test("synthesizeRateLimitDisposition does nothing when no rate limit was rejected", async (t) => {
  const fetchCalls = [];
  t.mock.method(globalThis, "fetch", async (...args) => { fetchCalls.push(args); throw new Error("must not be called"); });
  const context = { workbenchUrl: "https://workbench.example.test", taskToken: "task-token" };

  assert.equal(await synthesizeRateLimitDisposition(context, undefined, undefined), false);

  assert.equal(fetchCalls.length, 0);
  assert.equal(context.disposition, undefined);
});

test("synthesizeRateLimitDisposition escalates a credits-exhausted account to a real blocking Steering elicitation", async (t) => {
  let capturedUrl;
  let capturedBody;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ ok: true }) };
  });
  const context = { workbenchUrl: "https://workbench.example.test", taskToken: "task-token" };

  const handled = await synthesizeRateLimitDisposition(
    context,
    { status: "rejected", errorCode: "credits_required" },
    undefined,
  );

  assert.equal(handled, true);
  assert.equal(capturedUrl, "https://workbench.example.test/v1/linear-session");
  assert.equal(capturedBody.request.kind, "steering");
  assert.match(capturedBody.request.action, /out of usage credits/i);
  assert.equal(context.awaitingInput, true);
  assert.equal(context.attentionKind, "steering");
  assert.equal(context.disposition.status, "awaiting_steering");
});

test("synthesizeRateLimitDisposition marks a timed rate window blocked_external with a machine-parseable auto-resume marker, no network call", async (t) => {
  const fetchCalls = [];
  t.mock.method(globalThis, "fetch", async (...args) => { fetchCalls.push(args); throw new Error("must not be called for a plain rate window"); });
  const context = { workbenchUrl: "https://workbench.example.test", taskToken: "task-token" };
  const resetsAt = Date.UTC(2026, 7, 26, 18, 0, 0);

  const handled = await synthesizeRateLimitDisposition(
    context,
    { status: "rejected", rateLimitType: "five_hour", resetsAt },
    undefined,
  );

  assert.equal(handled, true);
  assert.equal(fetchCalls.length, 0);
  assert.equal(context.awaitingInput, false);
  assert.equal(context.disposition.status, "blocked_external");
  assert.match(context.disposition.reason, /five_hour/);
  assert.equal(context.disposition.nextAction, `auto-resume-at:${new Date(resetsAt).toISOString()}`);
});

test("synthesizeRateLimitDisposition falls back to a manual-resume message when the SDK reported no reset time", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("must not be called"); });
  const context = { workbenchUrl: "https://workbench.example.test", taskToken: "task-token" };

  const handled = await synthesizeRateLimitDisposition(context, { status: "rejected", rateLimitType: "overage" }, undefined);

  assert.equal(handled, true);
  assert.equal(context.disposition.status, "blocked_external");
  assert.doesNotMatch(context.disposition.nextAction, /auto-resume-at:/);
  assert.match(context.disposition.nextAction, /resume manually/i);
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

test("the request_attention tool description tells the model Signal needs no disclaimer and QA needs no reply instruction", () => {
  const { instance } = createStraylightTools(accessRepairWorkbenchContext());
  const description = instance._registeredTools.request_attention.description;
  assert.match(description, /don't add a "no action needed" or "work continues" disclaimer/i);
  assert.match(description, /don't instruct the engineer to type a specific word/i);
  assert.match(description, /Mark an evidence item's image field true when its url is a screenshot/i);
  assert.match(description, /push the branch and open or update its pull request first/i);
  assert.match(description, /don't request QA while its checks are still red or pending/i);
});

test("the manage_linear tool description tells the model subissue creation never accepts an assignee (GAB-25)", () => {
  const { instance } = createStraylightTools(accessRepairWorkbenchContext());
  const description = instance._registeredTools.manage_linear.description;
  assert.match(description, /Creating a subissue never accepts assigneeId or delegateId/);
  assert.match(description, /it always starts unassigned/);
});

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

test("the linear_activity tool description tells the model to lead an ask with a bold question", () => {
  const { instance } = createStraylightTools(accessRepairWorkbenchContext());
  assert.match(instance._registeredTools.linear_activity.description, /lead with the actual question in \*\*bold\*\*/i);
});

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

test("the linear_activity tool call forwards a non-blocking ask request verbatim to the workbench", async (t) => {
  const context = accessRepairWorkbenchContext();
  let capturedBody;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ ok: true, action: "ask", data: { commentId: "ask-1" } }) };
  });
  const handler = linearActivityHandler(context);

  const result = await handler({ request: { action: "ask", question: "Should this endpoint be paginated?" } }, {});

  assert.deepEqual(capturedBody, { action: "ask", question: "Should this endpoint be paginated?" });
  assert.deepEqual(result, { content: [{ type: "text", text: JSON.stringify({ ok: true, action: "ask", data: { commentId: "ask-1" } }, null, 2) }] });
});

function hoistRepositoryHandler(context) {
  const { instance } = createStraylightTools(context);
  return instance._registeredTools.hoist_repository.handler;
}

test("the hoist_repository tool description frames it as optional and at the agent's discretion", () => {
  const { instance } = createStraylightTools(accessRepairWorkbenchContext());
  const description = instance._registeredTools.hoist_repository.description;
  assert.match(description, /entirely optional and at your discretion/i);
  assert.match(description, /nothing hoists automatically/i);
});

test("the hoist_repository tool call forwards the request to the workbench's repository-hoist endpoint", async (t) => {
  const context = accessRepairWorkbenchContext();
  let capturedUrl;
  let capturedBody;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({ ok: true, path: "/repositories/dotfiles", hostname: "github.com", repositoryFullName: "GitSquared/dotfiles", alreadyCached: false }),
    };
  });
  const handler = hoistRepositoryHandler(context);

  const result = await handler({ hostname: "github.com", repositoryFullName: "GitSquared/dotfiles" }, {});

  assert.equal(capturedUrl, "https://workbench.example.test/v1/repository-hoist");
  assert.deepEqual(capturedBody, { hostname: "github.com", repositoryFullName: "GitSquared/dotfiles" });
  assert.deepEqual(result, {
    content: [{
      type: "text",
      text: JSON.stringify({ ok: true, path: "/repositories/dotfiles", hostname: "github.com", repositoryFullName: "GitSquared/dotfiles", alreadyCached: false }, null, 2),
    }],
  });
});

// Slice 19 (streaming input): runAgent's query() prompt is now a long-lived
// AsyncIterable built by createInputQueue, not a one-shot string - these
// tests drive that generator directly instead of exercising it through a
// real query() call, which would spawn the actual Claude Agent SDK.
test("createInputQueue yields the initial message immediately, then blocks until pushed", async () => {
  const queue = createInputQueue("do the thing");

  const first = await queue.stream.next();
  assert.equal(first.done, false);
  assert.deepEqual(first.value, {
    type: "user",
    message: { role: "user", content: "do the thing" },
    parent_tool_use_id: null,
  });

  let resolved = false;
  const pending = queue.stream.next().then((result) => {
    resolved = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(resolved, false, "the stream must not yield again until something is pushed");

  queue.push({ type: "user", message: { role: "user", content: "ping" }, parent_tool_use_id: null });
  const second = await pending;
  assert.equal(resolved, true);
  assert.equal(second.done, false);
  assert.equal(second.value.message.content, "ping");
});

test("createInputQueue's stream ends once closed", async () => {
  const queue = createInputQueue("do the thing");
  await queue.stream.next();

  const pending = queue.stream.next();
  queue.close();

  assert.equal((await pending).done, true);
});

test("createInputQueue reports its own unconsumed backlog via pendingCount", async () => {
  const queue = createInputQueue("do the thing");
  assert.equal(queue.pendingCount(), 1);
  await queue.stream.next();
  assert.equal(queue.pendingCount(), 0);
  queue.push({ type: "user", message: { role: "user", content: "ping" }, parent_tool_use_id: null });
  assert.equal(queue.pendingCount(), 1);
});

test("createInjector rejects injection while a blocking attention is open, without touching the queue", () => {
  const context = { awaitingInput: true, disposition: undefined };
  const pushed = [];
  const inject = createInjector(context, { push: (message) => pushed.push(message) });

  assert.deepEqual(inject("a live signal arrived"), { accepted: false, reason: "awaiting_input" });
  assert.equal(pushed.length, 0);
});

test("createInjector rejects injection once a terminal disposition is already recorded", () => {
  const context = { awaitingInput: false, disposition: { status: "awaiting_qa" } };
  const pushed = [];
  const inject = createInjector(context, { push: (message) => pushed.push(message) });

  assert.deepEqual(inject("a live signal arrived"), { accepted: false, reason: "terminal" });
  assert.equal(pushed.length, 0);
});

test("createInjector pushes a non-interrupting SDKUserMessage by default", () => {
  const context = { awaitingInput: false, disposition: undefined };
  const pushed = [];
  const inject = createInjector(context, { push: (message) => pushed.push(message) });

  assert.deepEqual(inject("keep it silent"), { accepted: true });
  assert.deepEqual(pushed, [{
    type: "user",
    message: { role: "user", content: "keep it silent" },
    parent_tool_use_id: null,
    shouldQuery: false,
  }]);
});

test("createInjector honors an explicit shouldQuery override", () => {
  const context = { awaitingInput: false, disposition: undefined };
  const pushed = [];
  const inject = createInjector(context, { push: (message) => pushed.push(message) });

  inject("actually, stop what you're doing", { shouldQuery: true });

  assert.equal(pushed[0].shouldQuery, true);
});
