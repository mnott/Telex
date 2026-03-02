// Re-export iTerm2 primitives from AIBroker
export {
  runAppleScript,
  stripItermPrefix,
  withSessionAppleScript,
  sendKeystrokeToSession,
  sendEscapeSequenceToSession,
  typeIntoSession,
  pasteTextIntoSession,
  findClaudeSession,
  isClaudeRunningInSession,
  isItermRunning,
  isItermSessionAlive,
  isScreenLocked,
  writeToTty,
  snapshotAllSessions,
} from "aibroker";
export type { SessionSnapshot } from "aibroker";
