import React from "react";
import { render } from "ink";
import { App, type TuiOptions } from "./App.js";
import { EXIT, type ExitCode } from "../exit.js";
import { enterTuiTerminal, leaveTuiTerminal } from "./terminal.js";

export async function runTui(opts: TuiOptions = {}): Promise<ExitCode> {
  const onUnhandled = (reason: unknown) => {
    console.error("irida tui: unhandled rejection:", reason);
  };
  process.on("unhandledRejection", onUnhandled);
  enterTuiTerminal();
  try {
    const { waitUntilExit } = render(<App {...opts} />);
    await waitUntilExit();
    return EXIT.ok;
  } finally {
    process.off("unhandledRejection", onUnhandled);
    leaveTuiTerminal();
  }
}

export { useAltScreen } from "./terminal.js";
