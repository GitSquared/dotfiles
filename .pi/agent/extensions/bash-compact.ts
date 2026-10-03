/**
 * Compact bash rendering.
 *
 * pi-tool-display collapses bash *output* but always prints the command
 * verbatim, so a long composite command (`rg ... | sed ... | xargs ...`) wraps
 * across several transcript lines. This owns bash and does two things:
 *
 * 1. renderCall  — the command on a single, width-aware line, clipped from the
 *                  middle so both the verb and its destination stay legible.
 * 2. renderResult — output collapsed to a few trailing lines, expandable with
 *                  pi's tool-output toggle. Failures are never collapsed.
 *
 * Execution is untouched: the built-in definition is spread and only the two
 * renderers are replaced.
 *
 * Companion setting: pi-tool-display's `registerToolOverrides.bash` must be
 * false, otherwise both extensions claim the bash tool. See
 * ~/.pi/agent/extensions/pi-tool-display/config.json
 */

import type { Component, Theme } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	createBashToolDefinition,
	defineTool,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

/** Ellipsis inserted where the command was clipped. */
const ELLIPSIS = " … ";

/** Never clip narrower than this, even in a very narrow terminal. */
const MIN_COMMAND_WIDTH = 24;

/**
 * Collapse a shell command onto one line, preserving literal spacing.
 *
 * Only line breaks and tabs are folded — runs of spaces are left alone because
 * they can be semantically significant inside quotes. Folding them would turn a
 * two-space sed replacement pattern into a one-space one, silently showing a
 * different command than the one that ran. That is worse than a long line.
 */
export function flattenCommand(command: string): string {
	return command.replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * Clip from the middle rather than the right.
 *
 * A right-truncation of `rg -n renderCall src | grep -v test | sort | uniq -c`
 * drops the part that says what the command is actually for. Keeping head and
 * tail preserves both the verb and the destination.
 */
export function clipCommand(command: string, budget: number): string {
	if (budget <= 0) return "";
	if (visibleWidth(command) <= budget) return command;

	const room = budget - ELLIPSIS.length;
	if (room <= 1) {
		return command.slice(0, Math.max(budget, 0)) + ELLIPSIS;
	}

	const head = Math.ceil(room / 2);
	const tail = room - head;
	return command.slice(0, head) + ELLIPSIS + command.slice(command.length - tail);
}

/** Trailing output lines shown while collapsed. */
const COLLAPSED_OUTPUT_LINES = 4;

/**
 * Extract the text a tool result carries, ignoring image parts.
 *
 * AssistantToolResult content is a mix of text and image blocks; only text can
 * be rendered as transcript lines.
 */
export function resultText(result: unknown): string {
	const content = (result as { content?: unknown })?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text: string } => {
			return typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text";
		})
		.map((part) => String(part.text ?? ""))
		.join("\n")
		.trimEnd();
}

class BashCallLine implements Component {
	constructor(
		private readonly command: string,
		private readonly theme: Theme,
	) {}

	render(width: number): string[] {
		const prefix = `${this.theme.fg("toolTitle", this.theme.bold("$"))} `;
		const budget = Math.max(MIN_COMMAND_WIDTH, width - visibleWidth(prefix));
		const line = prefix + this.theme.fg("accent", clipCommand(this.command, budget));
		return [truncateToWidth(line, width, "")];
	}

	/** Nothing is cached between renders, but the Component contract requires this. */
	invalidate(): void {}
}

class BashOutput implements Component {
	private expanded: boolean;

	constructor(
		private readonly output: string,
		private readonly isError: boolean,
		private readonly theme: Theme,
		expanded: boolean,
	) {
		this.expanded = expanded;
	}

	/** Recognised by pi as "expandable", so Ctrl+O re-renders this component. */
	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	/** Nothing is cached between renders, but the Component contract requires this. */
	invalidate(): void {}

	render(width: number): string[] {
		if (this.output.length === 0) return [];

		const lines = this.output.split("\n");
		// A failure is never collapsed: the reason a command broke is the one thing
		// that must not be hidden behind a keypress.
		const collapse = !this.expanded && !this.isError;
		const shown = collapse ? lines.slice(-COLLAPSED_OUTPUT_LINES) : lines;
		const hidden = lines.length - shown.length;

		const out: string[] = [""];
		if (hidden > 0) {
			out.push(this.theme.fg("muted", `... (${hidden} earlier lines, ctrl+o to expand)`));
		}
		const token = this.isError ? "error" : "toolOutput";
		for (const line of shown) {
			out.push(this.theme.fg(token, line));
		}
		return out.map((line) => truncateToWidth(line, width, ""));
	}
}

export default function bashCompact(pi: ExtensionAPI): void {
	const base = createBashToolDefinition(process.cwd());

	pi.registerTool(
		defineTool({
			...base,
			renderCall(args, theme) {
				const raw = typeof args?.command === "string" ? args.command : "";
				return new BashCallLine(flattenCommand(raw), theme);
			},
			renderResult(result, options, theme, _context) {
				return new BashOutput(
					resultText(result),
					options.isError === true,
					theme,
					options.expanded === true,
				);
			},
		}),
	);
}
