import React from "react";
import { render } from "ink";
import { App, type TuiOptions } from "./App.js";
import { EXIT, type ExitCode } from "../exit.js";

function enterAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?1049h\x1b[H\x1b[?25l");
}

function leaveAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25h\x1b[?1049l");
}

export async function runTui(opts: TuiOptions = {}): Promise<ExitCode> {
  enterAltScreen();
  try {
    const { waitUntilExit } = render(<App {...opts} />);
    await waitUntilExit();
    return EXIT.ok;
  } finally {
    leaveAltScreen();
  }
}
