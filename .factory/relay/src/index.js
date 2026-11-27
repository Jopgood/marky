// Marky Factory relay: our stand-in for Warp's webhook sources.
// A Cloudflare Worker that receives signed webhooks and turns them into
// GitHub repository_dispatch events, which start .github/workflows/factory.yml.
//
//   POST /linear         Linear webhook (Issues, Comments) → `linear-poll`, which
//                        runs linear-intake.mjs right away instead of on its cron.
//   POST /error-monitor  Standard Webhooks alert → `error-monitor`.
import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyPayload } from "../../../apps/error-monitor/src/webhooks/sign.ts";

const FACTORY_COMMENT = /^(\*\*Marky Factory|Marky Factory picked)/;
const LINEAR_TOLERANCE_MS = 60_000;

export function verifyLinear(secret, signature, body, now = Date.now()) {
	if (!secret || !signature) return false;
	const expected = Buffer.from(
		createHmac("sha256", secret).update(body).digest("hex"),
	);
	const actual = Buffer.from(signature);
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
		return false;
	const sent = JSON.parse(body).webhookTimestamp;
	return Math.abs(now - sent) <= LINEAR_TOLERANCE_MS;
}

/** Whether a Linear event could need the factory: a human comment, or a factory-labelled issue. */
export function linearWants(p) {
	if (p.type === "Comment" && p.action === "create")
		return !FACTORY_COMMENT.test(p.data?.body ?? "");
	if (p.type === "Issue" && (p.action === "create" || p.action === "update")) {
		// Payloads without label names still poke; the poller does the real filtering.
		const labels = p.data?.labels;
		return !labels || labels.some((l) => l.name === "factory");
	}
	return false;
}

async function dispatch(env, event_type, client_payload = {}) {
	const r = await fetch(
		`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.GITHUB_TOKEN}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"User-Agent": "marky-factory-relay",
			},
			body: JSON.stringify({ event_type, client_payload }),
		},
	);
	if (!r.ok)
		console.log(`dispatch ${event_type}: ${r.status} ${await r.text()}`);
	return new Response(r.ok ? "dispatched" : "dispatch failed", {
		status: r.ok ? 202 : 502,
	});
}

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);
		if (request.method !== "POST") return new Response("ok");
		const body = await request.text();

		if (pathname === "/linear") {
			const sig = request.headers.get("linear-signature");
			if (!verifyLinear(env.LINEAR_WEBHOOK_SECRET, sig, body))
				return new Response("bad signature", { status: 401 });
			if (!linearWants(JSON.parse(body))) return new Response("ignored");
			return dispatch(env, "linear-poll");
		}

		if (pathname === "/error-monitor" && env.MONITOR_WEBHOOK_SECRET) {
			const h = (n) => request.headers.get(n);
			const v = verifyPayload(
				env.MONITOR_WEBHOOK_SECRET,
				{
					id: h("webhook-id"),
					timestamp: h("webhook-timestamp"),
					signature: h("webhook-signature"),
				},
				body,
			);
			if (!v.ok) return new Response(v.reason, { status: 401 });
			return dispatch(env, "error-monitor", JSON.parse(body));
		}

		return new Response("not found", { status: 404 });
	},
};
