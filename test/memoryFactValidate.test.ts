import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryFactValidationError,
  isMalformedFactField,
  validateFactTriple,
} from "../src/memoryFactValidate.js";

test("validateFactTriple rejects flag-like fields", () => {
  assert.throws(() => validateFactTriple("--subject", "p", "o"), MemoryFactValidationError);
  assert.throws(() => validateFactTriple("s", "--predicate", "o"), MemoryFactValidationError);
  assert.doesNotThrow(() => validateFactTriple("seen_post", "123", "456"));
});

test("isMalformedFactField trims before check", () => {
  assert.equal(isMalformedFactField("  --dry-run"), true);
  assert.equal(isMalformedFactField("user.niksh.pref"), false);
});
