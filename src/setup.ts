import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { hasAuth } from "./auth.js";

const TELEX_DIR = join(homedir(), ".telex");
const CLAUDE_JSON = join(homedir(), ".claude.json");
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");

interface McpConfig {
  mcpServers?: Record<string, { command: string; args: string[] }>;
  [key: string]: unknown;
}

export async function setup(): Promise<void> {
  console.log("Telex Setup — Telegram Bridge for Claude Code\n");

  // 1. Check for Telegram API credentials
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    console.log("⚠️  Missing Telegram API credentials.\n");
    console.log("1. Go to https://my.telegram.org/apps");
    console.log("2. Create an application");
    console.log("3. Set environment variables:");
    console.log("   export TELEGRAM_API_ID=<your_api_id>");
    console.log("   export TELEGRAM_API_HASH=<your_api_hash>");
    console.log("   export TELEGRAM_PHONE=<+your_phone_number>");
    console.log("\nThen run `telex setup` again.\n");
    return;
  }

  // 2. Ensure ~/.telex/ directory
  if (!existsSync(TELEX_DIR)) {
    mkdirSync(TELEX_DIR, { recursive: true });
  }

  // 3. Register MCP server in claude settings
  registerMcpServer();

  // 4. Check existing auth
  if (hasAuth()) {
    console.log("✓ Existing Telegram session found.");
    console.log("  Run `telex watch` to start the watcher daemon.\n");
  } else {
    console.log("No existing session. Starting authentication...\n");
    console.log("Run `telex watch` to connect and authenticate.\n");
    console.log("You will need:");
    console.log("  - Your phone number (set TELEGRAM_PHONE env)");
    console.log("  - The verification code Telegram sends you");
    console.log("  - Your 2FA password if enabled (set TELEGRAM_2FA_PASSWORD env)\n");
  }

  console.log("✓ Setup complete.\n");
  console.log("Quick start:");
  console.log("  1. telex watch       # Start watcher daemon in a terminal");
  console.log("  2. Open Claude Code  # MCP tools auto-connect via IPC");
}

function registerMcpServer(): void {
  // Try claude.json first
  if (existsSync(CLAUDE_JSON)) {
    updateMcpConfig(CLAUDE_JSON);
    console.log(`✓ Registered MCP server in ${CLAUDE_JSON}`);
    return;
  }

  // Try settings.json (newer Claude Code)
  if (existsSync(CLAUDE_SETTINGS)) {
    // Settings.json uses a different format — just inform the user
    console.log("ℹ️  Add to your Claude Code MCP config:");
    console.log(JSON.stringify({
      telex: {
        command: "npx",
        args: ["-y", "telex"],
      },
    }, null, 2));
    return;
  }

  // Create claude.json
  const config: McpConfig = {
    mcpServers: {
      telex: {
        command: "npx",
        args: ["-y", "telex"],
      },
    },
  };
  writeFileSync(CLAUDE_JSON, JSON.stringify(config, null, 2), "utf-8");
  console.log(`✓ Created ${CLAUDE_JSON} with Telex MCP server`);
}

function updateMcpConfig(path: string): void {
  const content = readFileSync(path, "utf-8");
  const config: McpConfig = JSON.parse(content);

  if (!config.mcpServers) config.mcpServers = {};

  config.mcpServers.telex = {
    command: "npx",
    args: ["-y", "telex"],
  };

  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

export async function uninstall(): Promise<void> {
  console.log("Telex Uninstall\n");

  // Remove from claude.json
  if (existsSync(CLAUDE_JSON)) {
    try {
      const content = readFileSync(CLAUDE_JSON, "utf-8");
      const config: McpConfig = JSON.parse(content);
      if (config.mcpServers?.telex) {
        delete config.mcpServers.telex;
        writeFileSync(CLAUDE_JSON, JSON.stringify(config, null, 2), "utf-8");
        console.log(`✓ Removed from ${CLAUDE_JSON}`);
      }
    } catch {
      // ignore
    }
  }

  // Remove auth
  const authDir = join(TELEX_DIR, "auth");
  if (existsSync(authDir)) {
    rmSync(authDir, { recursive: true });
    console.log("✓ Removed auth credentials");
  }

  // Remove telex dir if empty
  try {
    const { readdirSync } = await import("node:fs");
    const remaining = readdirSync(TELEX_DIR);
    if (remaining.length === 0) {
      rmSync(TELEX_DIR, { recursive: true });
      console.log("✓ Removed ~/.telex/");
    }
  } catch {
    // ignore
  }

  console.log("\n✓ Uninstall complete.");
}
