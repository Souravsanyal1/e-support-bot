// Set testing environment variables before importing application modules
process.env.TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrsTUVwxyz12345678';
process.env.GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || 'AIzaSyDummyKeyForTestingPurposesOnly123';
process.env.BOT_MODE = 'polling';

import assert from 'assert';
import { Context } from 'grammy';

async function runTests() {
  console.log('--- Starting Elite Force Bot Test Suite ---');

  // Dynamically import modules after environment variables are set
  const { sanitizeInputString } = await import('../src/middleware/sanitizer');
  const { splitMessage } = await import('../src/utils/telegram');
  const { buildSystemPrompt } = await import('../src/ai/systemPrompt');
  const { sanitizeLogString, env } = await import('../src/config/env.config');
  const { conversationManager } = await import('../src/ai/conversation');
  const { rateLimiter } = await import('../src/middleware/rateLimiter');
  const { shouldRespondInGroup } = await import('../src/handlers/userHandler');

  // Test 1: Sanitizer
  console.log('Testing Sanitizer...');
  const inputWithNull = 'Hello\x00 World\x1F!  ';
  const sanitized = sanitizeInputString(inputWithNull);
  assert.strictEqual(sanitized, 'Hello World!', 'Sanitizer should strip control chars and null bytes');
  console.log('✓ Sanitizer passed');

  // Test 2: Message Splitting
  console.log('Testing Message Splitter...');
  const shortMsg = 'Short message';
  assert.strictEqual(splitMessage(shortMsg, 100).length, 1);

  const longMsg = 'Line 1\n\n' + 'A'.repeat(60) + '\n\n' + 'Line 3';
  const chunks = splitMessage(longMsg, 50);
  assert(chunks.length >= 2, 'Should chunk message exceeding max limit');
  console.log('✓ Message splitter passed');

  // Test 3: System Prompt Generation & Privacy Guardrails
  console.log('Testing System Prompt Generation & Privacy Guardrails...');
  const prompt = buildSystemPrompt();
  assert(prompt.includes('Elite Force AI'), 'Prompt must include bot name');
  assert(prompt.includes('ENGLISH ONLY'), 'Prompt must enforce English-only response rule');
  assert(prompt.includes('E-FORCE'), 'Prompt must include E-FORCE token details');
  assert(prompt.includes('https://t.me/Elite_Force_Official'), 'Prompt must include official Telegram channel');
  assert(prompt.includes('https://x.com/EliteForceOFC'), 'Prompt must include official X profile');
  assert(prompt.includes('DO NOT INVENT LAUNCH OR LISTING DATES'), 'Prompt must prohibit inventing dates');
  assert(prompt.includes('STRICT PRIVACY & INFRASTRUCTURE CONFIDENTIALITY'), 'Prompt must enforce server privacy');
  assert(prompt.includes('NEVER reveal server information'), 'Prompt must ban server disclosures');
  assert(prompt.includes('NEVER reveal personal information about developers'), 'Prompt must ban developer disclosures');
  console.log('✓ System prompt & privacy guardrails passed');

  // Test 4: Secret Redaction in Logs
  console.log('Testing Secret Redaction in Logs...');
  const dummyLog = `Error connecting with token ${process.env.TELEGRAM_BOT_TOKEN}`;
  const redacted = sanitizeLogString(dummyLog);
  assert(!redacted.includes('123456789:ABCdefGHIjklMNOpqrsTUVwxyz12345678'), 'Should redact active token');
  assert(redacted.includes('[REDACTED_TELEGRAM_TOKEN]'), 'Should contain redacted token placeholder');
  console.log('✓ Secret redaction passed');

  // Test 5: In-Memory Conversation Sliding Window & TTL
  console.log('Testing Conversation History Manager...');
  const testUserId = 999999;
  conversationManager.addMessage(testUserId, 'user', 'Question 1');
  conversationManager.addMessage(testUserId, 'model', 'Answer 1');
  const history = conversationManager.getHistory(testUserId);
  assert.strictEqual(history.length, 2, 'Should retrieve stored conversation turns');
  conversationManager.clearSession(testUserId);
  assert.strictEqual(conversationManager.getHistory(testUserId).length, 0, 'Should clear session correctly');
  console.log('✓ Conversation history manager passed');

  // Test 6: Rate Limiting
  console.log('Testing Anti-Spam Rate Limiter...');
  const spammerId = 888888;
  for (let i = 0; i < env.rateLimitMaxMessages; i++) {
    assert.strictEqual(rateLimiter.isRateLimited(spammerId), false, 'Should allow requests within limit');
  }
  assert.strictEqual(rateLimiter.isRateLimited(spammerId), true, 'Should block requests exceeding limit');
  console.log('✓ Anti-spam rate limiter passed');

  // Test 7: Telegram Group Trigger Logic (Anti-Spam)
  console.log('Testing Telegram Group Trigger Logic...');
  const mockMe = { id: 777777, username: 'Elite_Force_Support_Bot' };

  // Case A: Private chat -> Always respond
  const privateCtx = { chat: { type: 'private' }, me: mockMe, message: {} } as unknown as Context;
  assert.strictEqual(shouldRespondInGroup(privateCtx, 'random message'), true, 'Should always respond in private chat');

  // Case B: Group chat with unrelated message -> Do not respond
  const groupCtx = { chat: { type: 'group' }, me: mockMe, message: {} } as unknown as Context;
  assert.strictEqual(shouldRespondInGroup(groupCtx, 'good morning guys'), false, 'Should ignore unrelated group banter');

  // Case C: Group chat tagging bot -> Should respond
  assert.strictEqual(shouldRespondInGroup(groupCtx, '@Elite_Force_Support_Bot how are you?'), true, 'Should respond when tagged');

  // Case D: Group chat mentioning Elite Force -> Should respond
  assert.strictEqual(shouldRespondInGroup(groupCtx, 'What is Elite Force?'), true, 'Should respond when Elite Force is mentioned');
  assert.strictEqual(shouldRespondInGroup(groupCtx, 'eliteforce ki?'), true, 'Should respond when eliteforce is mentioned');

  // Case E: Direct reply to bot message -> Should respond
  const replyCtx = {
    chat: { type: 'supergroup' },
    me: mockMe,
    message: { reply_to_message: { from: { id: 777777 } } },
  } as unknown as Context;
  assert.strictEqual(shouldRespondInGroup(replyCtx, 'Yes please tell me more'), true, 'Should respond to direct replies to bot');
  // Test 8: Rich Text Formatting & Telegram Animated Custom Emojis
  console.log('Testing Telegram Rich Text & Animated Emojis...');
  const { formatToTelegramHtml, stripCustomEmojiTags, stripAllHtmlTags } = await import('../src/utils/telegramFormatter');

  const sampleText = 'Welcome to **Elite Force**! *Building Beyond Limits* 🧡 🤩';
  const htmlOutput = formatToTelegramHtml(sampleText);
  assert(htmlOutput.includes('<b>Elite Force</b>'), 'Must convert bold');
  assert(htmlOutput.includes('<i>Building Beyond Limits</i>'), 'Must convert italic');
  assert(htmlOutput.includes('<tg-emoji emoji-id="6201987489012394141">🧡</tg-emoji>'), 'Must convert 🧡 to animated custom emoji tag');
  assert(htmlOutput.includes('<tg-emoji emoji-id="6201982992181634064">🤩</tg-emoji>'), 'Must convert 🤩 to animated custom emoji tag');

  const macSample = 'Token 🪙 and Bot 🤖 with ⚡️ speed and 🔒 security!';
  const macOutput = formatToTelegramHtml(macSample);
  assert(macOutput.includes('<tg-emoji emoji-id="5258368777350816286">🪙</tg-emoji>'), 'Must convert 🪙 to animated token icon');
  assert(macOutput.includes('<tg-emoji emoji-id="5258093637450866522">🤖</tg-emoji>'), 'Must convert 🤖 to animated bot icon');
  assert(macOutput.includes('<tg-emoji emoji-id="5258152182150077732">⚡️</tg-emoji>'), 'Must convert ⚡️ to animated bolt icon');
  assert(macOutput.includes('<tg-emoji emoji-id="5258476306152038031">🔒</tg-emoji>'), 'Must convert 🔒 to animated lock icon');

  const strippedEmoji = stripCustomEmojiTags(htmlOutput);
  assert(!strippedEmoji.includes('<tg-emoji'), 'Must strip <tg-emoji> tags on fallback');
  assert(strippedEmoji.includes('🧡'), 'Must preserve fallback emoji character');

  const plainText = stripAllHtmlTags(htmlOutput);
  assert(!plainText.includes('<b>') && !plainText.includes('<i>'), 'Must strip all HTML on level-3 fallback');
  assert(plainText.includes('Elite Force'), 'Must preserve core text');
  console.log('✓ Rich text & animated custom emoji formatter passed');

  // Test 9: Language Detector (Bangla script, Banglish, other non-English, English)
  console.log('Testing Language Detector...');
  const { checkMessageLanguage } = await import('../src/utils/languageDetector');

  // 9a. Bangla Script (Bengali alphabet)
  const bangla1 = checkMessageLanguage('কেমন আছেন ভাই?');
  assert.strictEqual(bangla1.isEnglish, false, 'Bengali script must be detected as non-English');
  assert.strictEqual(bangla1.language, 'bangla', 'Language must be bangla');

  const bangla2 = checkMessageLanguage('কবে লঞ্চ হবে?');
  assert.strictEqual(bangla2.isEnglish, false, 'Bengali launch question must be detected');

  // 9b. Banglish (Romanized Bengali)
  const banglish1 = checkMessageLanguage('kemon acho vai');
  assert.strictEqual(banglish1.isEnglish, false, 'Banglish "kemon acho vai" must be rejected');
  assert.strictEqual(banglish1.language, 'banglish', 'Must identify banglish');

  const banglish2 = checkMessageLanguage('vai kobe launch hobe?');
  assert.strictEqual(banglish2.isEnglish, false, 'Banglish launch question must be rejected');

  const banglish3 = checkMessageLanguage('bhai listing kobe hobe?');
  assert.strictEqual(banglish3.isEnglish, false, 'Banglish listing question must be rejected');

  const banglish4 = checkMessageLanguage('amader token er price koto?');
  assert.strictEqual(banglish4.isEnglish, false, 'Banglish price question must be rejected');

  const banglish5 = checkMessageLanguage('tumi ki amake help korte paro?');
  assert.strictEqual(banglish5.isEnglish, false, 'Banglish help question must be rejected');

  const banglish6 = checkMessageLanguage('dhonnobad bhai');
  assert.strictEqual(banglish6.isEnglish, false, 'Banglish thank you must be rejected');

  const banglish7 = checkMessageLanguage('thik ache bro');
  assert.strictEqual(banglish7.isEnglish, false, 'Banglish "thik ache" must be rejected');

  // 9c. Other non-English languages (Hindi/Hinglish, Spanish, French, Cyrillic, Arabic)
  const hindi = checkMessageLanguage('kya haal hai bhai');
  assert.strictEqual(hindi.isEnglish, false, 'Hinglish must be rejected');

  const spanish = checkMessageLanguage('hola como estas amigo');
  assert.strictEqual(spanish.isEnglish, false, 'Spanish must be rejected');

  const french = checkMessageLanguage('bonjour comment ca va');
  assert.strictEqual(french.isEnglish, false, 'French must be rejected');

  const cyrillic = checkMessageLanguage('привет как дела');
  assert.strictEqual(cyrillic.isEnglish, false, 'Cyrillic script must be rejected');

  const arabic = checkMessageLanguage('مرحبا كيف الحال');
  assert.strictEqual(arabic.isEnglish, false, 'Arabic script must be rejected');

  // 9d. Valid English
  const english1 = checkMessageLanguage('What is Elite Force?');
  assert.strictEqual(english1.isEnglish, true, 'Standard English question must pass');

  const english2 = checkMessageLanguage('When will the E-FORCE token be listed on exchanges?');
  assert.strictEqual(english2.isEnglish, true, 'Complex English question must pass');

  const english3 = checkMessageLanguage('Hello, can you help me with the official website link?');
  assert.strictEqual(english3.isEnglish, true, 'Friendly English question must pass');

  const english4 = checkMessageLanguage('Who is the founder and CEO of Elite Force?');
  assert.strictEqual(english4.isEnglish, true, 'English question about founder must pass');

  const english5 = checkMessageLanguage('Hi');
  assert.strictEqual(english5.isEnglish, true, 'English greeting must pass');

  const english6 = checkMessageLanguage('gm guys');
  assert.strictEqual(english6.isEnglish, true, 'English crypto slang must pass');
  console.log('✓ Language detector passed (Bangla, Banglish, Foreign, English all verified)');

  // Test 10: Language Filter Middleware
  console.log('Testing Language Filter Middleware...');
  const { languageFilterMiddleware } = await import('../src/middleware/languageFilter');

  let deletedMessage = false;
  let nextCalled = false;

  const mockNonEnglishCtx = {
    message: { text: 'kobe launch hobe bhai?', message_id: 101 },
    chat: { id: 12345 },
    from: { id: 54321 },
    deleteMessage: async () => {
      deletedMessage = true;
      return true;
    },
  } as unknown as Context;

  await languageFilterMiddleware(mockNonEnglishCtx, async () => {
    nextCalled = true;
  });

  assert.strictEqual(deletedMessage, true, 'Middleware must delete non-English/Banglish message');
  assert.strictEqual(nextCalled, false, 'Middleware must NOT call next() for non-English message (no reply)');

  // Test English message through middleware
  let enDeleted = false;
  let enNextCalled = false;

  const mockEnglishCtx = {
    message: { text: 'When is the official launch?', message_id: 102 },
    chat: { id: 12345 },
    from: { id: 54321 },
    deleteMessage: async () => {
      enDeleted = true;
      return true;
    },
  } as unknown as Context;

  await languageFilterMiddleware(mockEnglishCtx, async () => {
    enNextCalled = true;
  });

  assert.strictEqual(enDeleted, false, 'Middleware must NOT delete English message');
  assert.strictEqual(enNextCalled, true, 'Middleware MUST call next() for English message');

  // Test /ask command in Banglish through middleware
  let askDeleted = false;
  let askNextCalled = false;

  const mockAskBanglishCtx = {
    message: { text: '/ask kemon acho vai', message_id: 103 },
    chat: { id: 12345 },
    from: { id: 54321 },
    deleteMessage: async () => {
      askDeleted = true;
      return true;
    },
  } as unknown as Context;

  await languageFilterMiddleware(mockAskBanglishCtx, async () => {
    askNextCalled = true;
  });

  assert.strictEqual(askDeleted, true, 'Middleware must delete Banglish /ask command');
  assert.strictEqual(askNextCalled, false, 'Middleware must NOT call next() for Banglish /ask (no reply)');

  // Test /ask command in English through middleware
  let askEnDeleted = false;
  let askEnNextCalled = false;

  const mockAskEnCtx = {
    message: { text: '/ask What is Elite Force?', message_id: 104 },
    chat: { id: 12345 },
    from: { id: 54321 },
    deleteMessage: async () => {
      askEnDeleted = true;
      return true;
    },
  } as unknown as Context;

  await languageFilterMiddleware(mockAskEnCtx, async () => {
    askEnNextCalled = true;
  });

  assert.strictEqual(askEnDeleted, false, 'Middleware must NOT delete English /ask command');
  assert.strictEqual(askEnNextCalled, true, 'Middleware MUST call next() for English /ask command');
  console.log('✓ Language filter middleware passed (silently deletes non-English, passes English)');

  // Cleanup timers
  rateLimiter.destroy();
  conversationManager.destroy();

  console.log('--- All Tests Passed Successfully! ---');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
