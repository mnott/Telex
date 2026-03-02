import { WatcherClient as AIBrokerClient } from "aibroker";

const TELEX_SOCKET_PATH = "/tmp/telex-watcher.sock";

/**
 * Telex-flavoured WatcherClient.
 *
 * Wraps AIBroker's WatcherClient (which requires a socket path) and adapts
 * the small number of methods whose call signatures differ from AIBroker's
 * generic API (tts, history, wait use Telegram-specific param shapes in the
 * existing MCP server code).
 */
export class WatcherClient {
  private readonly client: AIBrokerClient;

  constructor() {
    this.client = new AIBrokerClient(TELEX_SOCKET_PATH);
  }

  async register(): Promise<Record<string, unknown>> {
    return this.client.register();
  }

  async status(): Promise<Record<string, unknown>> {
    return this.client.status();
  }

  async send(
    message: string,
    recipient?: string,
  ): Promise<Record<string, unknown>> {
    return this.client.send(message, recipient);
  }

  async tts(
    text: string,
    recipient?: string,
    voice?: string,
  ): Promise<Record<string, unknown>> {
    return this.client.tts({ text, voice, recipient });
  }

  async sendFile(
    filePath: string,
    recipient?: string,
    caption?: string,
    prettify?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.client.sendFile(filePath, recipient, caption, prettify);
  }

  async receive(from?: string): Promise<Record<string, unknown>> {
    return this.client.receive(from);
  }

  async wait(timeoutMs?: number): Promise<Record<string, unknown>> {
    return this.client.wait(timeoutMs ?? 120_000);
  }

  async login(): Promise<Record<string, unknown>> {
    return this.client.login();
  }

  async contacts(
    search?: string,
    limit?: number,
  ): Promise<Record<string, unknown>> {
    return this.client.contacts(search, limit);
  }

  async chats(
    search?: string,
    limit?: number,
  ): Promise<Record<string, unknown>> {
    return this.client.chats(search, limit);
  }

  async history(
    chatId: string,
    count?: number,
  ): Promise<Record<string, unknown>> {
    return this.client.history({ chatId, count });
  }

  async voiceConfig(
    action: "get" | "set",
    config?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.client.voiceConfig(action, config);
  }

  async speak(text: string, voice?: string): Promise<Record<string, unknown>> {
    return this.client.speak(text, voice);
  }

  async rename(name: string): Promise<Record<string, unknown>> {
    return this.client.rename(name);
  }

  async restart(): Promise<Record<string, unknown>> {
    return this.client.restart();
  }

  async discover(): Promise<Record<string, unknown>> {
    return this.client.discover();
  }

  async sessions(): Promise<Record<string, unknown>> {
    return this.client.sessions();
  }

  async switchSession(target: string): Promise<Record<string, unknown>> {
    return this.client.switchSession(target);
  }

  async endSession(target: string): Promise<Record<string, unknown>> {
    return this.client.endSession(target);
  }

  async command(text: string): Promise<Record<string, unknown>> {
    return this.client.command(text);
  }
}
