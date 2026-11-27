import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { linearWants, verifyLinear } from "./index.js";

test("verifyLinear checks the HMAC and the timestamp", () => {
	const now = 1_800_000_000_000;
	const body = JSON.stringify({ type: "Comment", webhookTimestamp: now });
	const sig = createHmac("sha256", "s3cret").update(body).digest("hex");
	assert.equal(verifyLinear("s3cret", sig, body, now + 1000), true);
	assert.equal(verifyLinear("wrong", sig, body, now), false);
	assert.equal(verifyLinear("s3cret", sig, body, now + 120_000), false);
	assert.equal(verifyLinear("s3cret", null, body, now), false);
});

test("linearWants pokes for human comments and factory-labelled issues", () => {
	const comment = (body) => ({
		type: "Comment",
		action: "create",
		data: { body },
	});
	assert.equal(linearWants(comment("@factory why?")), true);
	assert.equal(linearWants(comment("**Marky Factory · spec**\n\nhi")), false);
	const issue = (labels) => ({
		type: "Issue",
		action: "update",
		data: { labels },
	});
	assert.equal(linearWants(issue([{ name: "factory" }])), true);
	assert.equal(linearWants(issue([{ name: "Bug" }])), false);
	assert.equal(
		linearWants({ type: "Issue", action: "remove", data: {} }),
		false,
	);
});
