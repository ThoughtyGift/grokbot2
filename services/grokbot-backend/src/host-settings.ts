/**
 * S1 · host settings — the app's own preferences, persisted next to the bots.
 *
 * They ride in `state.json` rather than a file of their own: they are written on the same
 * debounce as agents and transcripts, and splitting them would mean two files that can
 * disagree about the same save.
 */
import { loadState, scheduleSave } from "./store.js";
import { bindHostSettings, chatSnapshot } from "./chat/state.js";

const settings: Record<string, unknown> = {
  notifications: { isEnabled: false },
  mcpCustomInstructions: "",
  mcpCustomInstructionsByServerId: {},
  mcpDisabledToolsByServerId: {},
  mcpBoxServers: [],
  autoReviewInstructions: { isEnabled: false, allowInstructions: [], blockInstructions: [] },
  localToolPermission: "ask",
  webauthnProxyEnabled: false,
  userTimeZone: "UTC",
  sidebarSections: [],
  hasSeenOnboarding: true,
  ...(loadState().hostSettings ?? {}),   // restore persisted settings over the defaults
};

bindHostSettings(() => settings);   // so settings save alongside agents/transcripts

export const hostSettings = (): Record<string, unknown> => settings;

/** The FE sends partial patches ({notifications:{…}}, {userTimeZone:…}) — merge, don't discard. */
export function patchHostSettings(patch: unknown): Record<string, unknown> {
  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) settings[k] = v;
  }
  scheduleSave(() => ({ ...chatSnapshot(), hostSettings: settings }));
  return settings;
}
