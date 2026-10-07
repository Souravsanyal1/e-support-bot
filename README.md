# 🛡️ Elite Force AI — Telegram Community Support Bot

An enterprise-grade, production-ready Telegram AI Support Bot built for the **Elite Force** ecosystem. Powered by **Google Gemini** using the official `@google/genai` SDK and the modern **grammY** TypeScript framework.

Designed with a free-tier-first architecture, privacy by design, zero long-term storage of user credentials, anti-spam rate limiting, strict factual guardrails, and full bilingual support (English, Bengali, and Banglish).

---

## 🌟 Key Features

* **Official Google Gemini SDK**: Direct integration via `@google/genai` with exponential backoff retry logic.
* **Bilingual Support**: Fluent in English, natural Bengali (বাংলা), and conversational Banglish.
* **Strict Compliance & Anti-Hallucination**:
  * Prevents financial advice, price speculation, and return guarantees.
  * Clearly states when information is unconfirmed rather than hallucinating facts.
  * Directs community members toward official channels.
* **Enterprise Security**:
  * Zero hardcoded credentials or API tokens.
  * In-memory secret redaction in all internal logs and error handlers.
  * Input sanitization, length boundaries, and anti-spam rate limiting.
  * Webhook secret verification (`X-Telegram-Bot-Api-Secret-Token`) for webhook deployments.
* **Privacy-First Architecture**:
  * No sign-up or personal details are required to use the bot.
  * User messages are not retained as conversation history or used as training data.
  * Only public text and captions from `@Elite_Force_Official` are synchronized into the managed section of `AI_TRAINING_DATA.md`.
  * Regular users' raw Telegram IDs and chat IDs are not written to application logs or saved to disk. Admin IDs can remain in private server settings for access control. A one-way, process-only key is used for temporary anti-spam limits and is cleared shortly after its rate-limit window expires.
  * Message text is sent to the configured AI provider only to generate the current reply; it is not added to the bot's training data.
  * No collection or storage of emails, phone numbers, passwords, or seed phrases.
* **Admin Management**:
  * Environment-controlled numeric admin IDs (`ADMIN_USER_IDS`).
  * Admin-only commands: `/status`, `/reload`, `/users`, and `/broadcast`.

---

## 📋 Requirements

* **Node.js**: v20.0.0 or higher
* **npm**: v10.0.0 or higher
* **Telegram Bot Token**: Generated via Telegram's [@BotFather](https://t.me/BotFather)
* **Google Gemini API Key**: Acquired free from [Google AI Studio](https://aistudio.google.com/)

---

## 🚀 Quick Setup Guide

### 1. Create Your Telegram Bot with @BotFather

1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send the `/newbot` command.
3. Follow the prompts:
   * Enter the bot display name: `Elite Force AI`
   * Enter the bot username: `Elite_Force_Support_Bot` (or your chosen available username ending with `bot`).
4. @BotFather will generate your **HTTP API Token** (format: `123456789:ABCdefGHIjkl...`).
5. Keep this token strictly confidential.

---

### 2. Obtain a Google Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click on **Get API Key** and generate a new key.
4. Copy the API key and keep it secure.

---

### 3. How to Configure Admin Telegram IDs

To enable administrator commands (`/status`, `/reload`, `/broadcast`, `/users`):
1. Find your numeric Telegram User ID:
   * Message [@userinfobot](https://t.me/userinfobot) on Telegram to view your numeric ID (e.g., `123456789`).
2. Add your numeric ID to `ADMIN_USER_IDS` in your `.env` file. Multiple admins can be added as comma-separated values (e.g., `123456789,987654321`).
3. If this variable is left empty, administrative commands will remain completely disabled.

---

### 4. Configure Environment Variables

Copy the provided `.env.example` file to create your actual `.env` file:

```bash
cp .env.example .env
```

Open `.env` in your text editor and fill in your values:

```env
# Telegram Bot Token (from @BotFather)
TELEGRAM_BOT_TOKEN=your_actual_telegram_bot_token_here

# Google Gemini API Key (from Google AI Studio)
GEMINI_API_KEY=your_actual_gemini_api_key_here

# Gemini Model Selection (defaults to gemini-2.5-flash)
GEMINI_MODEL=gemini-2.5-flash

# Administrator Telegram IDs (comma-separated numeric IDs)
ADMIN_USER_IDS=123456789

# Bot Running Mode: 'polling' (default, free-tier friendly) or 'webhook'
BOT_MODE=polling

# Anti-Spam Rate Limiting Settings
RATE_LIMIT_MAX_MESSAGES=10
RATE_LIMIT_WINDOW_SECONDS=60

# Conversation Memory Settings
MAX_CONVERSATION_HISTORY=6
SESSION_TTL_MINUTES=30
```

> ⚠️ **Important**: Never commit your `.env` file to Git. The included `.gitignore` protects your secrets automatically.

---

### 5. Install Dependencies

Install all required production and development dependencies:

```bash
npm install
```

---

### 6. Run Locally

#### Development Mode (with hot-reload):
```bash
npm run dev
```

#### Production Build & Run:
```bash
npm run build
npm start
```

#### Run Automated Tests:
```bash
npm test
```

---

## 🤖 Available Commands

### Public Community Commands
| Command | Description |
| :--- | :--- |
| `/start` | Displays the welcome overview and interaction guide |
| `/help` | Shows the command list, tips, and language guidelines |
| `/about` | Explains the bot's mission, ecosystem pillars, and security |
| `/ask <question>` | Directly prompts the AI assistant with a question |

> **Direct Messaging:** Users can chat naturally without registration or commands. Each message is handled on its own; the bot does not retain chat history or regular users' raw Telegram IDs. Telegram still provides sender information to bots, and message text is sent to the configured AI provider to generate a response.

> **Group Chats:** The bot can reply to group questions, but group messages are never added to training data. Add it as a group admin, or disable Group Privacy through @BotFather so Telegram delivers regular group messages to it.

> **Anonymous Admin Use:** The bot requests anonymous administrator status by default for groups and channels. A chat admin must enable it when adding the bot; for an existing chat, update the bot's administrator rights in that chat's settings. Anonymous sender-chat messages are handled without identifying the hidden admin. Regular members' own messages remain visible according to Telegram's rules.

> **Channel Posts:** Add the bot to `@Elite_Force_Official` so Telegram can deliver new posts to it. The bot silently syncs new and edited text/captions into the managed section of `AI_TRAINING_DATA.md`; it never replies to a channel post. It starts with posts received after it is added; it cannot backfill older history. The training file includes a bounded digest of recent posts, while the local archive retains received posts for relevant lookups. User and group messages are never synced. Ask about Elite Force in a private chat with the bot.

### Administrator Commands (Protected)
| Command | Description |
| :--- | :--- |
| `/status` | Displays system uptime, memory usage, bot mode, model, and privacy status |
| `/reload` | Reloads knowledge and system prompt on the next response |
| `/broadcast <msg>` | Disabled because recipient user IDs are not stored; publish in the official channel |
| `/users` | Displays the bot's privacy and data-retention status |

---

## 🎨 How to Customize the AI Personality & Knowledge

The bot's personality, behavior rules, and ecosystem knowledge are fully modularized and located in dedicated files:

### 1. Changing Personality & Safety Rules
Edit [`src/ai/systemPrompt.ts`](file:///src/ai/systemPrompt.ts):
* **`DEFAULT_PROMPT_CONFIG.personality`**: Adjust tone (friendly, formal, technical).
* **`DEFAULT_PROMPT_CONFIG.maxWordsPerReply`**: Tune answer length.
* **`buildSystemPrompt()`**: Modify language prompts, few-shot examples, or safety boundaries.

### 2. Updating Ecosystem Knowledge
Edit [`src/config/knowledge.config.ts`](file:///src/config/knowledge.config.ts):
* **`ELITE_FORCE_KNOWLEDGE.description`**: Update official project description.
* **`ELITE_FORCE_KNOWLEDGE.corePillars`**: Add or modify ecosystem pillars.
* **`ELITE_FORCE_KNOWLEDGE.officialGuidelines`**: Update security advisories and official links.

---

## ☁️ Free-Tier Deployment Guide

The bot is designed to run easily on free-tier cloud platforms.

### Option A: Polling Mode on Render (Free Background Worker)
1. Push your repository to your private Git repository.
2. Sign in to [Render](https://render.com/).
3. Create a **New Background Worker** or **Web Service**.
4. Set:
   * **Build Command**: `npm install && npm run build`
   * **Start Command**: `npm start`
5. Under **Environment Variables**, add:
   * `TELEGRAM_BOT_TOKEN`
   * `GEMINI_API_KEY`
   * `GEMINI_MODEL=gemini-2.5-flash`
   * `ADMIN_USER_IDS=your_admin_id`
   * `BOT_MODE=polling`
6. Deploy! The bot will start polling Telegram immediately with zero server configuration needed.

---

### Option B: Webhook Mode on Free PaaS (Railway / Fly.io / Render Web Service)
1. Set the following environment variables in your hosting dashboard:
   * `BOT_MODE=webhook`
   * `PORT=3000` (or the port provided by your cloud provider)
   * `WEBHOOK_URL=https://your-service-subdomain.onrender.com/webhook`
   * `TELEGRAM_WEBHOOK_SECRET=generate_a_random_32_character_secret`
2. Start the service. The bot will automatically verify the webhook with Telegram using the secret token and listen on `/webhook`.
3. Health check requests from your host can hit `GET /health`.

---

## 🔒 Security Best Practices

1. **Never Commit Secrets**: Never push `.env` files or hardcode tokens into any file.
2. **Key Rotation**: If any key is compromised, immediately revoke and regenerate it via [@BotFather](https://t.me/BotFather) or [Google AI Studio](https://aistudio.google.com/). Review [`SECURITY.md`](file:///SECURITY.md) for full procedures.
3. **Admin Exclusivity**: Keep `ADMIN_USER_IDS` strictly limited to verified community managers.
4. **Error Sanitization**: Error handlers redact secrets automatically so that sensitive credentials are never leaked in logs or chat responses.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](file:///LICENSE) file for details.
