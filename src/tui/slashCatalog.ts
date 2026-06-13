/** TUI slash catalog — thin re-export from unified registry (Wave C2). */
import {
  tuiSlashCommands,
  tuiSlashHelpLines,
  filterSlashSuggestions as filterRegistrySuggestions,
  commonSlashPrefix,
  type TuiSlashCommandDef,
} from "../slashRegistry.js";

export type SlashCommandDef = TuiSlashCommandDef;

export const SLASH_COMMANDS: SlashCommandDef[] = tuiSlashCommands();

export function slashHelpLines(): string[] {
  return tuiSlashHelpLines();
}

export function filterSlashSuggestions(input: string): string[] {
  return filterRegistrySuggestions(input, SLASH_COMMANDS);
}

export { commonSlashPrefix };
