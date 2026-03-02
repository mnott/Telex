/**
 * screenshot.ts — Screenshot capture and Telegram delivery for the `/ss` command.
 *
 * Ported from Whazaa's screenshot.ts, adapted for Telegram.
 *
 * Two-phase pipeline:
 * 1. Screen-lock detection → text fallback if locked
 * 2. Image capture via screencapture -x -R <bounds> → send as Telegram photo
 */

import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execSync } from "node:child_process";

import { runAppleScript, stripItermPrefix } from "./iterm-core.js";
import { log } from "./log.js";
import {
  activeClientId,
  activeItermSessionId,
  setActiveItermSessionId,
  sessionRegistry,
  watcherClient,
  watcherStatus,
  sentMessageIds,
} from "./state.js";
import { watcherSendMessage } from "./send.js";

/**
 * Locked-screen fallback: read terminal buffer and send as text.
 */
export async function handleTextScreenshot(): Promise<void> {
  try {
    const candidates: Array<{ id: string; source: string }> = [];

    const activeEntry = activeClientId ? sessionRegistry.get(activeClientId) : undefined;
    const primaryId = stripItermPrefix(
      (activeItermSessionId || undefined) ?? activeEntry?.itermSessionId
    );
    if (primaryId) {
      candidates.push({ id: primaryId, source: "active" });
    }

    const registryEntries = [...sessionRegistry.values()]
      .sort((a, b) => b.registeredAt - a.registeredAt);
    for (const entry of registryEntries) {
      const rid = stripItermPrefix(entry.itermSessionId);
      if (rid && !candidates.some((c) => c.id === rid)) {
        candidates.push({ id: rid, source: `registry:${entry.name}` });
      }
    }

    if (candidates.length === 0) {
      await watcherSendMessage(
        "Screen is locked and no iTerm2 session found — cannot capture."
      ).catch(() => {});
      return;
    }

    for (const candidate of candidates) {
      const script = `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if id of s is "${candidate.id}" then
          return contents of s
        end if
      end repeat
    end repeat
  end repeat
  return "::NOT_FOUND::"
end tell`;

      const result = spawnSync("osascript", [], {
        input: script,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10_000,
      });

      const stdout = result.stdout?.toString().trim() ?? "";
      if (result.status !== 0 || stdout === "::NOT_FOUND::" || stdout === "") continue;

      const maxLen = 4000;
      const trimmed = stdout.length > maxLen
        ? "...\n" + stdout.slice(-maxLen)
        : stdout;

      await watcherSendMessage(
        `**Terminal capture (screen locked):**\n\n${trimmed}`
      ).catch(() => {});
      return;
    }

    await watcherSendMessage(
      `Screen is locked — tried ${candidates.length} session(s) but none returned buffer content.`
    ).catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`/ss: text capture error — ${msg}`);
    await watcherSendMessage(`Screen is locked — text capture failed: ${msg}`).catch(() => {});
  }
}

/**
 * Handle the `/ss` (screenshot) command.
 *
 * Captures the iTerm2 window containing the target Claude session and sends
 * it back as a Telegram photo.
 */
export async function handleScreenshot(): Promise<void> {
  await watcherSendMessage("Capturing screenshot...").catch(() => {});

  // Check if screen is locked
  try {
    const lockCheck = spawnSync(
      "sh",
      ["-c", "ioreg -n Root -d1 -a | grep -c CGSSessionScreenIsLocked"],
      { timeout: 5_000, encoding: "utf8" }
    );
    const lockCount = parseInt((lockCheck.stdout ?? "0").trim(), 10);
    if (lockCount > 0) {
      log("/ss: screen is locked — falling back to terminal text capture");
      await handleTextScreenshot();
      return;
    }
  } catch {
    // If check fails, proceed anyway
  }

  const filePath = join(tmpdir(), `telex-screenshot-${Date.now()}.png`);

  try {
    let windowId: string;

    try {
      const activeEntry = activeClientId ? sessionRegistry.get(activeClientId) : undefined;
      let itermSessionId = stripItermPrefix(
        (activeItermSessionId || undefined) ?? activeEntry?.itermSessionId
      );

      // Registry scan fallback
      if (!itermSessionId) {
        const registryEntries = [...sessionRegistry.values()]
          .sort((a, b) => b.registeredAt - a.registeredAt);
        const newest = registryEntries.find(e => e.itermSessionId);
        if (newest?.itermSessionId) {
          itermSessionId = stripItermPrefix(newest.itermSessionId);
          setActiveItermSessionId(itermSessionId!);
          log(`/ss: registry fallback to session ${newest.sessionId} (${newest.name})`);
        }
      }

      // Tab-name scan fallback
      if (!itermSessionId) {
        const { findClaudeSession } = await import("./iterm-core.js");
        const found = findClaudeSession();
        if (found) {
          itermSessionId = found;
          setActiveItermSessionId(found);
          log(`/ss: tab-name fallback — discovered session ${found}`);
        }
      }

      if (itermSessionId) {
        // Two-phase: raise window, get window ID
        const findAndRaiseScript = `tell application "iTerm2"
  repeat with w in windows
    set tabCount to count of tabs of w
    repeat with tabIdx from 1 to tabCount
      set t to tab tabIdx of w
      repeat with s in sessions of t
        if id of s is "${itermSessionId}" then
          select t
          set index of w to 1
          activate
          return (id of w as text)
        end if
      end repeat
    end repeat
  end repeat
  return ""
end tell`;
        const findResult = runAppleScript(findAndRaiseScript);
        if (findResult && findResult !== "") {
          windowId = findResult.trim();
          log(`/ss: found session ${itermSessionId} in window ${windowId}`);
        } else {
          runAppleScript('tell application "iTerm2" to activate');
          const fallbackResult = runAppleScript(`tell application "iTerm2"\n  set w to window 1\n  activate\n  return (id of w as text)\nend tell`) ?? "";
          windowId = fallbackResult.trim();
        }
      } else {
        runAppleScript('tell application "iTerm2" to activate');
        const fallbackResult = runAppleScript(`tell application "iTerm2"\n  set w to window 1\n  activate\n  return (id of w as text)\nend tell`) ?? "";
        windowId = fallbackResult.trim();
      }
    } catch {
      await watcherSendMessage("Error: iTerm2 is not running or has no open windows.").catch(() => {});
      return;
    }

    if (!windowId!) {
      await watcherSendMessage("Error: Could not get iTerm2 window ID.").catch(() => {});
      return;
    }

    // Wait for iTerm2 to fully redraw after being raised
    await new Promise((r) => setTimeout(r, 1500));

    // Re-read window bounds after delay
    const boundsScript = `tell application "iTerm2"
  repeat with w in windows
    if (id of w as text) is "${windowId}" then
      set wBounds to bounds of w
      set wx to item 1 of wBounds
      set wy to item 2 of wBounds
      set wx2 to item 3 of wBounds
      set wy2 to item 4 of wBounds
      return (wx as text) & "," & (wy as text) & "," & ((wx2 - wx) as text) & "," & ((wy2 - wy) as text)
    end if
  end repeat
  return ""
end tell`;
    const boundsResult = runAppleScript(boundsScript) ?? "";
    const bounds = boundsResult.trim();
    if (!bounds || !bounds.includes(",")) {
      throw new Error("Could not get window bounds from iTerm2");
    }

    log(`/ss: capturing screen region ${bounds}`);
    execSync(`screencapture -x -R ${bounds} "${filePath}"`, { timeout: 15_000 });

    const buffer = readFileSync(filePath);

    if (!watcherClient) {
      throw new Error("Telegram client not connected.");
    }

    // Send as Telegram photo
    const { CustomFile } = await import("telegram/client/uploads.js");
    const file = new CustomFile(
      "screenshot.png",
      buffer.length,
      "",
      buffer,
    );

    const result = await watcherClient.sendFile("me", {
      file,
      caption: "\uFEFFScreenshot",
    });

    if (result && result.id) {
      sentMessageIds.add(result.id);
      setTimeout(() => sentMessageIds.delete(result.id), 30_000);
    }

    log("/ss: screenshot sent successfully");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`/ss: error — ${msg}`);
    await watcherSendMessage(`Error taking screenshot: ${msg}`).catch(() => {});
  } finally {
    try {
      unlinkSync(filePath);
    } catch {
      // File may not exist if capture failed
    }
  }
}
