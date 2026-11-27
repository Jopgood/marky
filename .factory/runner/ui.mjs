#!/usr/bin/env node
// Drive the Marky desktop app for UI verification, from a factory worker's shell.
//
//   node .factory/runner/ui.mjs start            build deps, launch the app (xvfb on Linux), wait for it
//   node .factory/runner/ui.mjs eval '<js>'      run JS in the renderer, print the result as JSON
//   node .factory/runner/ui.mjs click X Y [right]  real mouse click at CSS pixels
//   node .factory/runner/ui.mjs type 'text'      insert text at the focus
//   node .factory/runner/ui.mjs shot <name>      save $FACTORY_ARTIFACTS/screenshots/<name>.png
//   node .factory/runner/ui.mjs publish          push the screenshots to the factory-media branch,
//                                                print Markdown image links for the PR
//   node .factory/runner/ui.mjs stop             stop the app
import { spawn, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9222;
const ART =
	process.env.FACTORY_ARTIFACTS ?? join(tmpdir(), "factory-artifacts");
const SHOTS = join(ART, "screenshots");
const PID = join(tmpdir(), "marky-factory-ui.pid");
const MEDIA_BRANCH = "factory-media";

function sh(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
	if (r.status !== 0)
		throw new Error(
			`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`,
		);
	return (r.stdout ?? "").trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
	const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) =>
		r.json(),
	);
	const page = list.find(
		(t) => t.type === "page" && !t.url.startsWith("devtools://"),
	);
	if (!page) throw new Error("No app window yet.");
	return page;
}

export async function cdp(method, params = {}) {
	const ws = new WebSocket((await target()).webSocketDebuggerUrl);
	await new Promise((res, rej) => {
		ws.onopen = res;
		ws.onerror = () => rej(new Error("CDP connection failed"));
	});
	ws.send(JSON.stringify({ id: 1, method, params }));
	const msg = await new Promise((res) => {
		ws.onmessage = (e) => {
			const m = JSON.parse(e.data);
			if (m.id === 1) res(m);
		};
	});
	ws.close();
	if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
	return msg.result;
}

async function evaluate(expression) {
	const { result, exceptionDetails } = await cdp("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (exceptionDetails)
		throw new Error(exceptionDetails.exception?.description ?? "eval failed");
	return result.value;
}

async function start() {
	if (existsSync(PID)) await stop();
	mkdirSync(ART, { recursive: true });
	console.log("Building workspace packages the app imports…");
	sh("pnpm", ["--filter", "@marky/desktop^...", "--if-present", "build"], {
		stdio: "inherit",
	});
	const dev = [
		"pnpm",
		"--filter",
		"@marky/desktop",
		"dev",
		"--remoteDebuggingPort",
		String(PORT),
	];
	const [cmd, ...args] =
		process.platform === "linux"
			? ["xvfb-run", "-a", "-s", "-screen 0 1440x900x24", ...dev, "--noSandbox"]
			: dev;
	const log = openSync(join(ART, "app.log"), "a");
	const child = spawn(cmd, args, {
		detached: true,
		stdio: ["ignore", log, log],
	});
	child.unref();
	writeFileSync(PID, String(child.pid));

	// ponytail: fixed 3 min budget; raise it if cold runner builds get slower.
	for (let i = 0; i < 180; i++) {
		await sleep(1000);
		try {
			if ((await evaluate("document.readyState")) === "complete") {
				await sleep(3000); // let React settle after first paint
				const title = await evaluate("document.title");
				console.log(`App ready (${title}). Log: ${join(ART, "app.log")}`);
				return;
			}
		} catch {}
	}
	console.log(readFileSync(join(ART, "app.log"), "utf8").slice(-4000));
	throw new Error("App did not start within 3 minutes; log tail above.");
}

async function stop() {
	if (!existsSync(PID)) return console.log("App is not running.");
	const pid = Number(readFileSync(PID, "utf8"));
	try {
		process.kill(-pid, "SIGTERM");
		await sleep(2000);
		process.kill(-pid, "SIGKILL");
	} catch {}
	rmSync(PID, { force: true });
	console.log("App stopped.");
}

async function click(x, y, right) {
	const button = right ? "right" : "left";
	const at = { x: Number(x), y: Number(y) };
	await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	for (const type of ["mousePressed", "mouseReleased"])
		await cdp("Input.dispatchMouseEvent", {
			type,
			...at,
			button,
			clickCount: 1,
		});
}

async function shot(name) {
	if (!name) throw new Error("Usage: shot <name>");
	mkdirSync(SHOTS, { recursive: true });
	const { data } = await cdp("Page.captureScreenshot", { format: "png" });
	const file = join(SHOTS, `${name.replace(/[^\w.-]+/g, "-")}.png`);
	writeFileSync(file, Buffer.from(data, "base64"));
	console.log(file);
}

// Screenshots live on an orphan branch, never the PR branch, so the PR can
// show them inline (the repo is public, so raw URLs render).
function publish() {
	const files = existsSync(SHOTS)
		? readdirSync(SHOTS).filter((f) => f.endsWith(".png"))
		: [];
	if (!files.length) throw new Error(`No screenshots in ${SHOTS}.`);
	const repo =
		process.env.GITHUB_REPOSITORY ??
		sh("gh", [
			"repo",
			"view",
			"--json",
			"nameWithOwner",
			"-q",
			".nameWithOwner",
		]);
	const folder = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
	const dir = mkdtempSync(join(tmpdir(), "factory-media-"));
	rmSync(dir, { recursive: true });
	const exists =
		spawnSync("git", ["fetch", "-q", "origin", MEDIA_BRANCH]).status === 0;
	sh(
		"git",
		exists
			? ["worktree", "add", "-q", "--detach", dir, "FETCH_HEAD"]
			: ["worktree", "add", "-q", "--orphan", "-b", `media-${folder}`, dir],
	);
	try {
		cpSync(SHOTS, join(dir, folder), { recursive: true });
		sh("git", ["-C", dir, "add", "-A"]);
		sh("git", ["-C", dir, "commit", "-qm", `Screenshots for run ${folder}`]);
		// ponytail: no retry; two runs publishing in the same second can race.
		sh("git", [
			"-C",
			dir,
			"push",
			"-q",
			"origin",
			`HEAD:refs/heads/${MEDIA_BRANCH}`,
		]);
	} finally {
		spawnSync("git", ["worktree", "remove", "--force", dir]);
		spawnSync("git", ["branch", "-D", `media-${folder}`]);
	}
	for (const f of files)
		console.log(
			`![${f.replace(/\.png$/, "")}](https://raw.githubusercontent.com/${repo}/${MEDIA_BRANCH}/${folder}/${f})`,
		);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
	start,
	stop,
	shot: () => shot(rest[0]),
	click: () => click(rest[0], rest[1], rest[2] === "right"),
	type: () => cdp("Input.insertText", { text: rest.join(" ") }),
	eval: async () =>
		console.log(JSON.stringify(await evaluate(rest.join(" ")), null, 2)),
	publish,
};
if (!commands[cmd]) {
	console.log(
		readFileSync(new URL(import.meta.url), "utf8").split("\nimport")[0],
	);
	process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
