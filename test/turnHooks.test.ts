import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runPreTurnHook, runPostTurnHook, HOOK_STDOUT_MAX_CHARS } from "../src/turnHooks.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "hooks-"));
}

test("runPreTurnHook allows exit 0 and appends stdout", () => {
  const dir = tmp();
  const hook = join(dir, "pre.sh");
  writeFileSync(hook, "#!/bin/sh\necho HOOK_APPEND\n", { mode: 0o755 });
  const out = runPreTurnHook({ command: hook }, { prompt: "hi", sessionId: "s1", channel: "tui", cwd: dir });
  assert.equal(out.allowed, true);
  assert.equal(out.appendStdout, "HOOK_APPEND");
});

test("runPreTurnHook denies on exit 2", () => {
  const dir = tmp();
  const hook = join(dir, "deny.sh");
  writeFileSync(hook, "#!/bin/sh\nexit 2\n", { mode: 0o755 });
  const out = runPreTurnHook({ command: hook }, { prompt: "hi", sessionId: "s1", channel: "tui", cwd: dir });
  assert.equal(out.allowed, false);
});

test("runPreTurnHook truncates long stdout", () => {
  const dir = tmp();
  const hook = join(dir, "long.sh");
  writeFileSync(hook, `#!/bin/sh\nprintf '%*s' ${HOOK_STDOUT_MAX_CHARS + 100} | tr ' ' 'x'\n`, {
    mode: 0o755,
  });
  const out = runPreTurnHook({ command: hook }, { prompt: "hi", sessionId: "s1", channel: "tui", cwd: dir });
  assert.equal(out.allowed, true);
  assert.ok((out.appendStdout?.length ?? 0) <= HOOK_STDOUT_MAX_CHARS + 1);
});

test("runPostTurnHook does not throw on failure", () => {
  const dir = tmp();
  const hook = join(dir, "fail.sh");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const logs: string[] = [];
  assert.doesNotThrow(() =>
    runPostTurnHook({ command: hook }, { prompt: "hi", sessionId: "s1", channel: "tui", cwd: dir }, (l) =>
      logs.push(l)
    )
  );
  assert.ok(logs.some((l) => l.includes("postTurn")));
});
