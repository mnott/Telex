import { watcherClient, watcherStatus } from "./state.js";
import { log } from "./log.js";

let typingInterval: ReturnType<typeof setInterval> | null = null;

export function startTypingIndicator(chatId?: string): void {
  stopTypingIndicator();

  const target = chatId ?? "me";

  const sendTyping = async () => {
    try {
      if (watcherClient && watcherStatus.connected) {
        await watcherClient.invoke(
          new (await import("telegram/tl/index.js")).Api.messages.SetTyping({
            peer: target,
            action: new (
              await import("telegram/tl/index.js")
            ).Api.SendMessageTypingAction(),
          }),
        );
      }
    } catch {
      // ignore — best effort
    }
  };

  sendTyping();
  typingInterval = setInterval(sendTyping, 5000);
}

export function stopTypingIndicator(): void {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
}
