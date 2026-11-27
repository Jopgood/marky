// Linear intake for Marky Factory. A scheduled workflow runs this every few
// minutes. It finds Linear issues that match automations/linear-issues, takes
// the `factory` label off (re-adding it starts a new run, like Warp), moves the
// issue to In Progress, finds or opens its GitHub tracking issue, and starts
// the factory with a `linear-issue` repository_dispatch.
//
// ponytail: polling, so pickup takes up to ~5 min (Actions cron is best-effort).
// Swap for a Linear webhook → relay → repository_dispatch if that matters.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./run-stage.mjs";

const FACTORY_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = process.env.GITHUB_REPOSITORY;

export async function linear(query, variables = {}) {
	const r = await fetch("https://api.linear.app/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: process.env.LINEAR_API_KEY,
		},
		body: JSON.stringify({ query, variables }),
	});
	const json = await r.json();
	if (json.errors) throw new Error(JSON.stringify(json.errors));
	return json.data;
}

export const linearComment = (issueId, body) =>
	linear("mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}", {
		i: { issueId, body },
	});

/** GitHub issue number from a Linear issue's attachments, if one links here. */
export function trackingIssue(attachments, repoName) {
	const re = new RegExp(`github\\.com/${repoName}/issues/(\\d+)`, "i");
	for (const a of attachments) {
		const m = a.url.match(re);
		if (m) return Number(m[1]);
	}
	return null;
}

function gh(args, input) {
	const r = spawnSync("gh", args, { encoding: "utf8", input });
	if (r.status !== 0) throw new Error(`gh ${args[0]} failed: ${r.stderr}`);
	return r.stdout.trim();
}

const ISSUES = `query($team:String!,$project:String!,$label:String!){
  issues(first:50, filter:{
    team:{key:{eq:$team}}, project:{name:{eq:$project}},
    labels:{some:{name:{eq:$label}}},
    state:{type:{nin:["completed","canceled"]}}
  }){ nodes{
    id identifier url title description creator{name}
    team{ states(filter:{type:{eq:"started"}}){ nodes{ id position } } }
    labels{ nodes{ id name } }
    attachments{ nodes{ url } }
  } }
}`;

export async function main() {
	const { meta } = parseFrontmatter(
		readFileSync(
			join(FACTORY_DIR, "automations/linear-issues/automation.md"),
			"utf8",
		),
	);
	const { teams, projects, labels } = meta.triggers[0].filter;
	for (const team of teams)
		for (const project of projects)
			for (const label of labels) {
				const { issues } = await linear(ISSUES, { team, project, label });
				for (const l of issues.nodes) await pickUp(l, label);
			}
}

async function pickUp(l, label) {
	let number = trackingIssue(l.attachments.nodes, repo);
	if (!number) {
		const url = gh(
			[
				"issue",
				"create",
				"--repo",
				repo,
				"--title",
				`${l.identifier} ${l.title}`,
				"--body-file",
				"-",
			],
			`Tracking issue for Linear [${l.identifier}](${l.url}), opened by Marky Factory.\n\n${l.description ?? ""}`,
		);
		number = Number(url.split("/").at(-1));
		await linear(
			"mutation($i:AttachmentCreateInput!){attachmentCreate(input:$i){success}}",
			{ i: { issueId: l.id, url, title: `GitHub #${number}` } },
		);
	}
	const ghUrl = `https://github.com/${repo}/issues/${number}`;
	const started = l.team.states.nodes.sort(
		(a, b) => a.position - b.position,
	)[0];
	const labelId = l.labels.nodes.find((x) => x.name === label).id;
	await linear(
		"mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}",
		{
			id: l.id,
			i: {
				removedLabelIds: [labelId],
				...(started && { stateId: started.id }),
			},
		},
	);
	await linearComment(
		l.id,
		`Marky Factory picked this up. Updates post here and on [GitHub #${number}](${ghUrl}). Reply on GitHub when the factory asks a question.`,
	);
	gh(
		["api", "-X", "POST", `repos/${repo}/dispatches`, "--input", "-"],
		JSON.stringify({
			event_type: "linear-issue",
			client_payload: {
				issue: number,
				linear: {
					id: l.id,
					identifier: l.identifier,
					url: l.url,
					title: l.title,
					description: (l.description ?? "").slice(0, 50000),
					creator: l.creator?.name ?? "unknown",
				},
			},
		}),
	);
	console.log(`${l.identifier} → #${number}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.env.LINEAR_API_KEY) await main();
	else console.log("LINEAR_API_KEY is not set; skipping Linear intake.");
}
