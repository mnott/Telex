// Re-export iTerm2 session management from AIBroker
export {
  setItermSessionVar,
  setItermTabName,
  getItermSessionVar,
  findItermSessionForTermId,
  listClaudeSessions,
  getSessionList,
  createClaudeSession,
  createTerminalTab,
  restartSession,
  killSession,
} from "aibroker";
