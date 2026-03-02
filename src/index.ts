#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WatcherClient } from "./ipc-client.js";

// ── CLI Dispatch ──

const command = process.argv[2];

switch (command) {
  case "setup":
    import("./setup.js").then((m) => m.setup());
    break;
  case "uninstall":
    import("./setup.js").then((m) => m.uninstall());
    break;
  case "watch":
    import("./watcher/index.js").then((m) => m.watch(process.argv[3]));
    break;
  default:
    startMcpServer();
    break;
}

// ── MCP Server ──

async function startMcpServer(): Promise<void> {
  const watcher = new WatcherClient();

  // Register with watcher daemon
  try {
    await watcher.register();
  } catch {
    // Watcher may not be running yet — tools will fail gracefully
  }

  const server = new McpServer({
    name: "telex",
    version: "0.1.0",
  });

  // ── telegram_status ──
  server.tool("telegram_status", "Check Telegram connection status", {}, async () => {
    const result = await watcher.status();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  // ── telegram_send ──
  server.tool(
    "telegram_send",
    "Send a text message via Telegram",
    {
      message: z.string().describe("The message to send"),
      recipient: z
        .string()
        .optional()
        .describe("Recipient: username, phone, chat ID, or name. Default: Saved Messages (self)"),
      voice: z
        .boolean()
        .optional()
        .describe("If true, send as voice note via TTS instead of text"),
    },
    async ({ message, recipient, voice }) => {
      const result = await watcher.send(message, recipient);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_tts ──
  server.tool(
    "telegram_tts",
    "Send a voice note via Telegram (text-to-speech via Kokoro)",
    {
      text: z.string().describe("Text to convert to speech and send"),
      recipient: z.string().optional().describe("Recipient. Default: Saved Messages"),
      voice: z.string().optional().describe("Voice name (e.g., bm_fable, af_heart)"),
    },
    async ({ text, recipient, voice }) => {
      const result = await watcher.tts(text, recipient, voice);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_send_file ──
  server.tool(
    "telegram_send_file",
    "Send a file via Telegram",
    {
      filePath: z.string().describe("Absolute path to the file"),
      recipient: z.string().optional().describe("Recipient. Default: Saved Messages"),
      caption: z.string().optional().describe("Caption for the file"),
      prettify: z
        .boolean()
        .optional()
        .describe("If true, send text files as formatted Telegram messages"),
    },
    async ({ filePath, recipient, caption, prettify }) => {
      const result = await watcher.sendFile(filePath, recipient, caption, prettify);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_receive ──
  server.tool(
    "telegram_receive",
    "Receive buffered messages from Telegram",
    {
      from: z
        .string()
        .optional()
        .describe('Source: omit for self-chat, "all" for all, or a chat ID/name'),
    },
    async ({ from }) => {
      const result = await watcher.receive(from);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_wait ──
  server.tool(
    "telegram_wait",
    "Long-poll for incoming Telegram messages (blocks until message arrives or timeout)",
    {
      timeoutMs: z
        .number()
        .optional()
        .describe("Max wait time in milliseconds (default 120000, max 300000)"),
    },
    async ({ timeoutMs }) => {
      const result = await watcher.wait(timeoutMs);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_login ──
  server.tool(
    "telegram_login",
    "Trigger fresh Telegram authentication",
    {},
    async () => {
      const result = await watcher.login();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_contacts ──
  server.tool(
    "telegram_contacts",
    "List Telegram contacts",
    {
      search: z.string().optional().describe("Search filter for name/username"),
      limit: z.number().optional().describe("Max results to return"),
    },
    async ({ search, limit }) => {
      const result = await watcher.contacts(search, limit);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_chats ──
  server.tool(
    "telegram_chats",
    "List Telegram chats",
    {
      search: z.string().optional().describe("Search filter"),
      limit: z.number().optional().describe("Max results (default 50)"),
    },
    async ({ search, limit }) => {
      const result = await watcher.chats(search, limit);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_history ──
  server.tool(
    "telegram_history",
    "Get message history for a chat",
    {
      chatId: z.string().describe("Chat ID, username, or 'me' for Saved Messages"),
      count: z.number().optional().describe("Number of messages (default 20)"),
    },
    async ({ chatId, count }) => {
      const result = await watcher.history(chatId, count);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_voice_config ──
  server.tool(
    "telegram_voice_config",
    "Get or set voice/TTS configuration",
    {
      action: z.enum(["get", "set"]).describe("Action: get or set"),
      defaultVoice: z.string().optional().describe("Default TTS voice"),
      voiceMode: z.boolean().optional().describe("Auto voice mode"),
      localMode: z.boolean().optional().describe("Local playback mode"),
      personas: z
        .record(z.string())
        .optional()
        .describe("Voice personas mapping"),
    },
    async ({ action, defaultVoice, voiceMode, localMode, personas }) => {
      const result = await watcher.voiceConfig(action, {
        defaultVoice,
        voiceMode,
        localMode,
        personas,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_speak ──
  server.tool(
    "telegram_speak",
    "Play text-to-speech locally (no Telegram send)",
    {
      text: z.string().describe("Text to speak"),
      voice: z.string().optional().describe("Voice to use"),
    },
    async ({ text, voice }) => {
      const result = await watcher.speak(text, voice);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_rename ──
  server.tool(
    "telegram_rename",
    "Rename the current Claude session",
    {
      name: z.string().describe("New session name"),
    },
    async ({ name }) => {
      const result = await watcher.rename(name);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_restart ──
  server.tool(
    "telegram_restart",
    "Restart the current Claude session",
    {},
    async () => {
      const result = await watcher.restart();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_discover ──
  server.tool(
    "telegram_discover",
    "Discover and prune Claude sessions",
    {},
    async () => {
      const result = await watcher.discover();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_sessions ──
  server.tool(
    "telegram_sessions",
    "List all Claude sessions",
    {},
    async () => {
      const result = await watcher.sessions();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_switch ──
  server.tool(
    "telegram_switch",
    "Switch to a different Claude session",
    {
      target: z
        .string()
        .describe("Session index (1-based) or name substring"),
    },
    async ({ target }) => {
      const result = await watcher.switchSession(target);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_end_session ──
  server.tool(
    "telegram_end_session",
    "End (close) a Claude session",
    {
      target: z
        .string()
        .describe("Session index (1-based) or name substring"),
    },
    async ({ target }) => {
      const result = await watcher.endSession(target);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── telegram_command ──
  server.tool(
    "telegram_command",
    "Execute a slash command directly (bypass Telegram round-trip)",
    {
      text: z.string().describe("Command text (e.g., /sessions, /restart)"),
    },
    async ({ text }) => {
      const result = await watcher.command(text);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Start MCP transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
