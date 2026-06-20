import { runTui } from "./tui/render.js";

export interface TuiCmdOptions {
  dir?: string;
  skills?: string[];
  yesIUnderstand?: boolean;
  engine?: string;
  auth?: string;
}

export async function cmdTui(opts: TuiCmdOptions = {}): Promise<number> {
  return runTui(opts);
}
