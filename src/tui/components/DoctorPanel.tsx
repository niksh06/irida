import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import { gatherDoctorChecks, gatherDoctorApiChecks, doctorAllOk } from "../../doctorChecks.js";

export function DoctorPanel(props: { dir: string; onClose: () => void }) {
  const [checks, setChecks] = useState(() => gatherDoctorChecks(props.dir));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sync = gatherDoctorChecks(props.dir);
      const api = await gatherDoctorApiChecks(props.dir);
      if (!cancelled) setChecks([...sync, ...api]);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.dir]);

  const allOk = doctorAllOk(checks);

  useInput((_input, key) => {
    if (key.escape || key.return) props.onClose();
  });

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.primary}>
        doctor {allOk ? "✓" : "✗"}
      </Text>
      {checks.map((c) => (
        <Text key={c.name}>
          <Text color={c.ok ? theme.system : theme.error}>{c.ok ? "OK  " : "FAIL"}</Text>
          {"  "}
          {c.name}: <Text dimColor>{c.detail}</Text>
        </Text>
      ))}
      <Text dimColor>Esc or Enter to close</Text>
    </Box>
  );
}
