# Security Policy

This security policy outlines the standards and procedures for maintaining security in the Elite Force AI Community Support Bot.

## Core Security Commitments

1. **Zero Secret Exposure**:
   - Never commit `.env` or any configuration files containing secret values.
   - All sensitive credentials (such as `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, and `TELEGRAM_WEBHOOK_SECRET`) must be provided strictly through environment variables.
   - The `.gitignore` file must be preserved and must strictly block secret files and environment files from Git version control.

2. **No Secret Logging**:
   - Internal logs are sanitized to prevent Telegram bot tokens, API keys, webhook secrets, authorization headers, or private user credentials from appearing in standard output or error logs.
   - Error messages returned to Telegram users are sanitized and user-friendly. Stack traces and internal paths are never exposed to users in Telegram chats.

3. **Key Rotation Procedures**:
   If a secret or API credential is ever suspected to be compromised:
   - **Telegram Bot Token**: Immediately open [@BotFather](https://t.me/BotFather) on Telegram, execute `/revoke` on the bot token, obtain a new token, update your production environment variables, and restart the bot.
   - **Google Gemini API Key**: Immediately navigate to [Google AI Studio](https://aistudio.google.com/), delete the compromised API key, generate a fresh key, update your production environment variables, and restart the bot.
   - **Webhook Secret**: Generate a new random secret string, update both `TELEGRAM_WEBHOOK_SECRET` in your hosting environment and the webhook registration on Telegram.

4. **Environment Isolation**:
   - Keep environment variables restricted to authorized server runtime environments.
   - Do not share production environment files over unsecured communication channels.

5. **Rate Limiting & Abuse Prevention**:
   - In-memory rate limiting is enforced to mitigate spam, flooding attacks, and unauthorized API quota exhaustion.
   - Incoming messages are size-bounded and sanitized before processing.

6. **Reporting a Security Vulnerability**:
   - If you discover a security vulnerability within this repository, please report it responsibly by opening a private security advisory through the repository platform or contacting the project maintainers via official community channels.
   - Please provide reproduction steps, impact assessment, and allow reasonable time for remediation before any public disclosure.
