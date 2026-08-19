import assert from "node:assert/strict";
import test from "node:test";
import { assertAgentMayAct, assertTerminalSummary, createProgressProjector, recordWorkDisposition, runtimeBudgetInstruction, stopDispositionGuard } from "./agent-request.mjs";

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
    { type: "thought", body: "Thinking: private chain of thought" },
    { type: "thought", body: "I found the relevant module." },
    { type: "action", action: "Running command", parameter: "rg -n TODO src", result: "12s elapsed" },
    { type: "thought", body: "Claude is retrying a model request (2/4, HTTP 529)." },
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

test("rejects an informal follow-up outside the attention state machine", () => {
  const context = {
    awaitingInput: false,
    attentionKind: undefined,
    disposition: { status: "deferred", reason: "Authorized pause.", nextAction: "Resume next week." },
    stopRepairRequested: true,
  };
  assert.throws(() => assertTerminalSummary(context, "All good; let me know if you want more."), /outside the Linear attention state machine/);
});

test("repairs a prose blocker that lacks a Linear attention issue", () => {
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
  assert.match(decision.reason, /no blocking attention issue exists/);
});

test("only request_attention can record a human-owned transition", () => {
  assert.throws(
    () => recordWorkDisposition({ awaitingInput: false }, { status: "awaiting_steering", reason: "Need access." }),
    /must use request_attention/,
  );
});
