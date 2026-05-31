import { test } from "node:test";
import assert from "node:assert/strict";
import { makeNoteName } from "../src/importHappyinKb.js";

test("makeNoteName keeps domain.slug under 64 chars", () => {
  const short = makeNoteName("kafka", "consumer-groups");
  assert.equal(short, "kafka.consumer-groups");
  assert.ok(short.length <= 64);

  const longSlug = "spatialedit-16b-geometric-control-for-diffusion-based-image-editing";
  const long = makeNoteName("image-generation", longSlug);
  assert.ok(long.length <= 64);
  assert.ok(long.startsWith("image-generation."));
  assert.notEqual(long, `image-generation.${longSlug}`);
});

test("makeNoteName sanitizes invalid slug characters", () => {
  assert.equal(makeNoteName("image-generation", "ACE++"), "image-generation.ACE");
});
