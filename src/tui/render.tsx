import React from "react";
import { render } from "ink";
import { App, type TuiOptions } from "./App.js";
import { EXIT, type ExitCode } from "../exit.js";

export async function runTui(opts: TuiOptions = {}): Promise<ExitCode> {
  const { waitUntilExit } = render(<App {...opts} />);
  await waitUntilExit();
  return EXIT.ok;
}
