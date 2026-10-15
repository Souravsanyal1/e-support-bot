import { Context, InlineKeyboard } from 'grammy';
import { QuizManager, Quiz } from '../services/quizManager';
import { isAdmin } from '../middleware/adminAuth';
import { safeReply } from '../utils/telegram';
import { logger } from '../utils/logger';

const getQuizManager = () => QuizManager.getInstance();

/**
 * Builds Telegram InlineKeyboard with interactive option buttons for a quiz.
 */
export function buildQuizKeyboard(quiz: Quiz): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  quiz.options.forEach((opt, idx) => {
    keyboard.text(`${opt.id}. ${opt.text}`, `quiz_ans:${quiz.id}:${opt.id}`);
    // Place 2 buttons per row for nice layout
    if ((idx + 1) % 2 === 0 && idx !== quiz.options.length - 1) {
      keyboard.row();
    }
  });
  return keyboard;
}

/**
 * Formats a quiz question and its options for Telegram Markdown.
 */
export function formatQuizMessage(quiz: Quiz): string {
  const optionsText = quiz.options
    .map((opt) => `• *${opt.id}.* ${opt.text}`)
    .join('\n');

  return (
    `🧠 *Elite Force Community Quiz*\n\n` +
    `❓ *Question:*\n*${quiz.question}*\n\n` +
    `*Options:*\n${optionsText}\n\n` +
    `_Tap an option button below to submit your answer and earn +1 Point!_ 🧡`
  );
}

/**
 * Handles the /quiz command for both administrators (creation/management)
 * and regular users (viewing/participating in the active quiz).
 */
export async function handleQuizCommand(ctx: Context): Promise<void> {
  const senderId = ctx.from?.id;
  const isUserAdmin = senderId ? isAdmin(senderId) : false;
  const text = ctx.message?.text?.trim() || '';
  const args = text.replace(/^\/quiz(@\w+)?/i, '').trim();

  // If sender is NOT an admin, show active quiz or inform them
  if (!isUserAdmin) {
    const activeQuiz = getQuizManager().getActiveQuiz();
    if (!activeQuiz) {
      await safeReply(
        ctx,
        `ℹ️ *No active quiz right now.*\n\n` +
        `Stay tuned! Community quizzes will be posted here soon. Check your points anytime using \`/point\`. 🧡`
      );
      return;
    }

    if (senderId && getQuizManager().hasUserAnswered(activeQuiz.id, senderId)) {
      await safeReply(
        ctx,
        `ℹ️ *You have already answered the current quiz!*\n\n` +
        `Use \`/point\` to check your total earned points and rank. 🏆`
      );
      return;
    }

    const messageText = formatQuizMessage(activeQuiz);
    const keyboard = buildQuizKeyboard(activeQuiz);

    await ctx.reply(messageText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    return;
  }

  // ── ADMIN QUIZ MANAGEMENT ───────────────────────────────────────────────
  if (!args || args.toLowerCase() === 'help') {
    const activeQuiz = getQuizManager().getActiveQuiz();
    const statusStr = activeQuiz
      ? `🟢 *Active Quiz ID:* \`${activeQuiz.id}\`\n❓ *Question:* ${activeQuiz.question}\n👥 *Participants:* ${activeQuiz.totalAttempts} (Correct: ${activeQuiz.correctAnswersCount})`
      : `⚪ *No active quiz.*`;

    await safeReply(
      ctx,
      `🎯 *Admin Quiz Manager*\n\n` +
      `*Current Status:*\n${statusStr}\n\n` +
      `*How to create a new Quiz:*\n` +
      `\`/quiz <Question> | <Option 1> | <Option 2> | [Option 3] | [Option 4] | <Correct Option Number>\`\n\n` +
      `*Example:*\n` +
      `\`/quiz What is the native token of Elite Force? | E-FORCE | BNB | SOL | 1\`\n\n` +
      `*Other Commands:*\n` +
      `• \`/quiz status\` — View active quiz statistics\n` +
      `• \`/quiz post\` — Broadcast/Post active quiz with buttons to this chat\n` +
      `• \`/quiz close\` — Close the active quiz`
    );
    return;
  }

  const lowerArgs = args.toLowerCase();

  // Command: /quiz status
  if (lowerArgs === 'status') {
    const activeQuiz = getQuizManager().getActiveQuiz();
    if (!activeQuiz) {
      await safeReply(ctx, `⚪ *There is currently no active quiz.* Use \`/quiz <Question> | ...\` to create one.`);
      return;
    }

    const optionsStr = activeQuiz.options
      .map((opt) => `${opt.id === activeQuiz.correctOptionId ? '✅' : '▫️'} ${opt.id}. ${opt.text}`)
      .join('\n');

    await safeReply(
      ctx,
      `📊 *Active Quiz Details*\n\n` +
      `*ID:* \`${activeQuiz.id}\`\n` +
      `*Question:* *${activeQuiz.question}*\n` +
      `*Options:*\n${optionsStr}\n\n` +
      `👥 *Total Participants:* ${activeQuiz.totalAttempts}\n` +
      `🎯 *Correct Answers:* ${activeQuiz.correctAnswersCount}\n` +
      `📅 *Created:* ${new Date(activeQuiz.createdAt).toLocaleString()}`
    );
    return;
  }

  // Command: /quiz close or /quiz end
  if (lowerArgs === 'close' || lowerArgs === 'end') {
    const closed = getQuizManager().closeActiveQuiz();
    if (closed) {
      logger.info('Admin closed active quiz', { adminId: senderId });
      await safeReply(ctx, `🔒 *Active quiz closed successfully.* Users can no longer submit answers.`);
    } else {
      await safeReply(ctx, `ℹ️ No active quiz was found to close.`);
    }
    return;
  }

  // Command: /quiz post
  if (lowerArgs === 'post') {
    const activeQuiz = getQuizManager().getActiveQuiz();
    if (!activeQuiz) {
      await safeReply(ctx, `⚠️ No active quiz to post. Create one first using \`/quiz <Question> | ...\``);
      return;
    }

    const messageText = formatQuizMessage(activeQuiz);
    const keyboard = buildQuizKeyboard(activeQuiz);

    await ctx.reply(messageText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    return;
  }

  // Creation syntax: Question | Opt1 | Opt2 | [Opt3] | [Opt4] | CorrectOptionNum
  const rawParts = args.split('|').map((p) => p.trim()).filter(Boolean);

  if (rawParts.length < 3) {
    await safeReply(
      ctx,
      `⚠️ *Invalid Quiz Format.*\n\n` +
      `*Correct Syntax:*\n` +
      `\`/quiz <Question> | <Option 1> | <Option 2> | [Option 3] | <Correct Option Number>\`\n\n` +
      `*Example:*\n` +
      `\`/quiz What blockchain is Elite Force on? | BNB Smart Chain | Solana | Ethereum | 1\``
    );
    return;
  }

  const question = rawParts[0];
  const lastPart = rawParts[rawParts.length - 1];
  const correctOptionId = parseInt(lastPart, 10);

  if (isNaN(correctOptionId)) {
    await safeReply(
      ctx,
      `⚠️ The last parameter must be the correct option number (e.g. 1, 2, or 3). Got: "${lastPart}"`
    );
    return;
  }

  const options = rawParts.slice(1, rawParts.length - 1);

  if (options.length < 2) {
    await safeReply(ctx, `⚠️ A quiz must have at least 2 options.`);
    return;
  }

  if (correctOptionId < 1 || correctOptionId > options.length) {
    await safeReply(
      ctx,
      `⚠️ Correct option number must be between 1 and ${options.length}. Got: ${correctOptionId}`
    );
    return;
  }

  // Create & activate quiz
  const newQuiz = getQuizManager().createQuiz({
    question,
    options,
    correctOptionId,
    adminId: senderId,
  });

  const previewText = formatQuizMessage(newQuiz);
  const previewKeyboard = buildQuizKeyboard(newQuiz);

  await ctx.reply(
    `✅ *New Quiz Created & Activated Successfully!*\n\n${previewText}`,
    {
      parse_mode: 'Markdown',
      reply_markup: previewKeyboard,
    }
  );
}

/**
 * Handles the /point and /points command for users.
 * Displays their earned points, quizzes completed, community rank, and top leaderboard.
 */
export async function handlePointCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Member');
  const userStats = getQuizManager().getUserPoints(userId);
  const leaderboard = getQuizManager().getLeaderboard(5);

  let leaderboardText = '';
  if (leaderboard.length > 0) {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    const lines = leaderboard.map((u, i) => {
      const uName = u.username ? `@${u.username}` : (u.firstName || `User ${u.userId}`);
      const medal = medals[i] || `${i + 1}.`;
      return `${medal} ${uName} — *${u.points}* pts`;
    });
    leaderboardText = `\n──────────────────────\n🌟 *Top Leaderboard:*\n` + lines.join('\n') + '\n';
  }

  const message =
    `🏆 *Elite Force Member Profile*\n\n` +
    `👤 *User:* ${username}\n` +
    `⭐ *Total Points:* *${userStats.points}* Point${userStats.points === 1 ? '' : 's'}\n` +
    `🎯 *Quizzes Completed:* ${userStats.quizzesAnswered}\n` +
    `🏅 *Community Rank:* #${userStats.rank} (out of ${userStats.totalParticipants})` +
    leaderboardText +
    `\n_Keep answering community quizzes with \`/quiz\` to earn more points!_ 🧡🚀`;

  await safeReply(ctx, message);
}

/**
 * Handles callback queries when users tap an option button on a quiz.
 */
export async function handleQuizCallback(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;
  if (!callbackData || !callbackData.startsWith('quiz_ans:')) {
    return;
  }

  const parts = callbackData.split(':');
  const quizId = parts[1];
  const optionId = parseInt(parts[2], 10);

  const userId = ctx.from?.id;
  if (!userId) return;

  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name || 'Member';
  const displayName = username ? `@${username}` : firstName;

  const result = getQuizManager().submitAnswer({
    quizId,
    userId,
    optionId,
    username,
    firstName,
  });

  if (!result.success) {
    if (result.alreadyAnswered) {
      await ctx.answerCallbackQuery({
        text: '⚠️ You have already answered this quiz!',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: '⚠️ This quiz is no longer available.',
      show_alert: true,
    });
    return;
  }

  if (result.isCorrect) {
    await ctx.answerCallbackQuery({
      text: `🎉 Correct answer! You earned +1 point! (Total: ${result.totalPoints})`,
      show_alert: true,
    });

    try {
      await ctx.reply(
        `🎉 *Correct Answer, ${displayName}!*\n` +
        `You earned *+1 Point*! 🏆\n` +
        `⭐ *Your Total Points:* *${result.totalPoints}*\n\n` +
        `_Check your rank anytime using_ \`/point\`! 🚀`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // Suppress reply errors
    }
  } else {
    await ctx.answerCallbackQuery({
      text: '❌ Incorrect answer! Better luck next time.',
      show_alert: true,
    });

    try {
      await ctx.reply(
        `❌ *Incorrect Answer, ${displayName}!*\n` +
        `The correct answer was: *${result.correctOptionText || 'Option ' + optionId}*.\n\n` +
        `_Keep participating in community quizzes to earn points!_ 🧡`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // Suppress reply errors
    }
  }
}
