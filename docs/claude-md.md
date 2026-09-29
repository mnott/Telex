# Best practices for CLAUDE.md

To get the most out of Telex, add these rules to your `CLAUDE.md` (or `~/.claude/CLAUDE.md` for global config):

# Mirror every response to Telegram

Tell Claude to send the same content it prints on the terminal to Telegram, so you can follow along from your phone:

```
Every response you give on the terminal MUST also be sent to Telegram via telegram_send.
Send the same content - do not shorten or paraphrase.
Adapt markdown for Telegram: use **bold** and *italic* only. No headers, no code blocks.
```

# Acknowledge before long tasks

If Claude is about to spawn agents, read multiple files, or do anything that takes more than a few seconds, it should send a brief Telegram message **first** - before calling any other tools. Otherwise your phone goes silent and you don't know if Claude heard you.

```
If a task will take more than a few seconds, your FIRST tool call must be
telegram_send with a brief acknowledgment (e.g. "On it - researching that now.").
Then proceed with the actual work. Never leave Telegram silent while working.
```

# Drain the queue at session start

Messages you send from your phone while Claude is generating a response may be queued. Call `telegram_receive` early in each session to catch them:

```
At the start of every session, call telegram_receive to drain any queued
messages that arrived while you were offline.
```
