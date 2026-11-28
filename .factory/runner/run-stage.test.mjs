import assert from "node:assert/strict";
import { test } from "node:test";
import {
	chooseNext,
	extractResult,
	matchesFilter,
	parseFrontmatter,
	readState,
	routes,
	writeState,
} from "./run-stage.mjs";

const spec = {
	to: [
		{ stage: "implement", when: "approved" },
		{ stage: "spec", when: "feedback" },
	],
};

test("routes normalizes string and list forms", () => {
	assert.deepEqual(routes({ to: "end" }), [{ stage: "end", when: "" }]);
	assert.equal(routes(spec).length, 2);
});

test("chooseNext keeps the worker on the blueprint", () => {
	assert.equal(chooseNext(spec, { next: "implement" }), "implement");
	assert.equal(chooseNext(spec, { next: "wait" }), "wait");
	assert.equal(chooseNext(spec, { next: "deploy" }), "wait");
	assert.equal(chooseNext(spec, null), "wait");
	assert.equal(chooseNext({ to: "handoff" }, {}), "handoff");
});

test("extractResult takes the last json block", () => {
	const text =
		'```json\n{"next":"spec"}\n```\nthen\n```json\n{"next":"implement","outputs":{"pr":"x"}}\n```';
	assert.equal(extractResult(text).next, "implement");
	assert.equal(extractResult("no block"), null);
	assert.equal(extractResult("```json\n{oops\n```"), null);
});

test("state round-trips through a comment, even with -- in it", () => {
	const state = {
		issue: 3,
		next: "spec",
		waiting: "spec",
		request: "a -- b -->",
	};
	const body = writeState(state);
	assert.ok(!body.slice(0, body.indexOf("-->")).includes("--", 25));
	assert.deepEqual(
		readState([
			{ id: 1, body: "hi" },
			{ id: 9, body },
		]),
		{
			commentId: 9,
			state,
		},
	);
	assert.equal(readState([{ id: 1, body: "hi" }]), null);
});

test("matchesFilter checks every payload key", () => {
	const f = { type: ["issue.created", "issue.regressed"] };
	assert.ok(matchesFilter(f, { type: "issue.created" }));
	assert.ok(!matchesFilter(f, { type: "test" }));
});

test("parseFrontmatter splits meta and body", () => {
	const { meta, body } = parseFrontmatter(
		"---\nagentType: FOREMAN\n---\n# Foreman\n",
	);
	assert.equal(meta.agentType, "FOREMAN");
	assert.equal(body, "# Foreman");
});

test("trackingIssue finds the GitHub issue a Linear issue links to", async () => {
	const { trackingIssue } = await import("./linear-intake.mjs");
	const a = [
		{ url: "https://example.com" },
		{ url: "https://github.com/Jopgood/marky/issues/7" },
	];
	assert.equal(trackingIssue(a, "Jopgood/marky"), 7);
	assert.equal(trackingIssue(a, "other/repo"), null);
});

test("newReplies forwards member comments after the pickup, once", async () => {
	const { newReplies } = await import("./linear-intake.mjs");
	const c = (id, at, body, extra = {}) => ({
		id,
		createdAt: `2026-11-27T21:${at}:00Z`,
		body,
		user: { name: "James", guest: false },
		reactions: [],
		...extra,
	});
	const comments = [
		c("old", "10", "before pickup"),
		c("p", "20", "Marky Factory picked this up."),
		c("chat", "20", "nice, thanks"),
		c("f", "21", "**Marky Factory · spec**\n\nQuestions"),
		c("r1", "22", "Put it in both menus"),
		c("ping", "22", "@factory also check the tests"),
		c("seen", "23", "already sent", { reactions: [{ emoji: "👀" }] }),
		c("named", "23", "seen by name", { reactions: [{ emoji: "eyes" }] }),
		c("guest", "24", "hi", { user: { name: "G", guest: true } }),
		c("bot", "25", "hi", { user: null }),
	];
	const ids = (waiting) => newReplies(comments, waiting).map((x) => x.id);
	// Waiting: answers after the factory's question, never chat from before it.
	assert.deepEqual(ids(true), ["r1", "ping"]);
	// Done or running: only an @factory mention reaches it (and gets a 👀).
	assert.deepEqual(ids(false), ["ping"]);
});
