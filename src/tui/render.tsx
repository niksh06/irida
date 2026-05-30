import React from "react";
import { render } from "ink";
import { App, type TuiOptions } from "./App.js";
import { EXIT, type ExitCode } from "../exit.js";
import { enterTuiTerminal, leaveTuiTerminal } from "./terminal.js";

export async function runTui(opts: TuiOptions = {}): Promise<ExitCode> {
  enterTuiTerminal();
  try {
    const { waitUntilExit } = render(<App {...opts} />);
    await waitUntilExit();
    return EXIT.ok;
  } finally {
    leaveTuiTerminal();
  }
}

export { useAltScreen } from "./terminal.js";
