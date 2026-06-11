import React, { useEffect, useState } from "react";
import { Text, useInput } from "ink";
import { theme } from "../theme.js";
import { gatherDoctorChecks, gatherDoctorApiChecks, gatherDoctorStoreChecks, doctorAllOk } from "../../doctorChecks.js";
import { OverlayPanel } from "./OverlayPanel.js";

export function DoctorPanel(props: { dir: string; onClose: () => void }) {
  const [checks, setChecks] = useState(() => gatherDoctorChecks(props.dir));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sync = gatherDoctorChecks(props.dir);
      const store = await gatherDoctorStoreChecks(props.dir);
      const api = await gatherDoctorApiChecks(props.dir);
      if (!cancelled) setChecks([...sync, ...store, ...api]);
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
    <OverlayPanel title={`doctor ${allOk ? "✓" : "✗"}`} footer="Esc or Enter to close">
      {checks.map((c) => (
        <React.Fragment key={c.name}>
          <Text>
            <Text color={c.ok ? theme.system : theme.error}>{c.ok ? "OK  " : "FAIL"}</Text>
            {"  "}
            {c.name}: <Text dimColor>{c.detail}</Text>
          </Text>
          {!c.ok && c.fix ? (
            <Text>
              {"      "}
              <Text color={theme.system}>↳ fix:</Text> <Text dimColor>{c.fix}</Text>
            </Text>
          ) : null}
        </React.Fragment>
      ))}
    </OverlayPanel>
  );
}
