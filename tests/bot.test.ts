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
  console.log('✓ Telegram group trigger logic passed');

  // Cleanup timers
  rateLimiter.destroy();
  conversationManager.destroy();

  console.log('--- All Tests Passed Successfully! ---');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
