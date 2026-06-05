import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresFtsQuery, sqliteFtsMatchQuery } from "../src/memorySearch.js";

test("sqliteFtsMatchQuery builds prefix AND query", () => {
  assert.equal(sqliteFtsMatchQuery("launchd gateway"), '"launchd"* AND "gateway"*');
  assert.equal(sqliteFtsMatchQuery("a"), "");
});

test("postgresFtsQuery trims input", () => {
  assert.equal(postgresFtsQuery("  kafka  "), "kafka");
});
