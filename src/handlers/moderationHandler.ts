import { Context } from 'grammy';
import { ChatPermissions } from 'grammy/types';
import { isAdmin } from '../middleware/adminAuth';
import { logger } from '../utils/logger';

const ALLOWED_HOURS = new Set([24, 48, 72]);
const NO_CHAT_PERMISSIONS: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_react_to_messages: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
  can_edit_tag: false,
};

type ModerationAction = 'ban' | 'limit';

async function handleModeration(ctx: Context, action: ModerationAction): Promise<void> {
  const rawText = ctx.message?.text?.trim() ?? '';
  const commandMatch = rawText.match(/^\/(?:ban|limit)(?:@\w+)?(?:\s+(.*))?$/i);
  const duration = commandMatch?.[1]?.trim();
  const replyTarget = ctx.message?.reply_to_message?.from;

  if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
    await ctx.reply('This command can only be used in a group or supergroup.');
    return;
  }

  const permanentBan = action === 'ban' && !duration;
  if (!permanentBan && (!duration || !/^\d+$/.test(duration) || !ALLOWED_HOURS.has(Number(duration)))) {
    const usage = action === 'ban' ? '/ban (permanent), /ban 24, /ban 48, or /ban 72' : '/limit 24, /limit 48, or /limit 72';
    await ctx.reply(`Usage: reply to a member's message with ${usage}.`);
    return;
  }

  if (!replyTarget) {
    await ctx.reply(permanentBan
      ? 'Reply to the member\'s message, then use /ban to permanently ban them.'
      : `Reply to the member's message, then use /${action} ${duration}.`);
    return;
  }

  if (replyTarget.is_bot || (ctx.me && replyTarget.id === ctx.me.id)) {
    await ctx.reply('Bots cannot be moderated with this command.');
    return;
  }

  if (isAdmin(replyTarget.id)) {
    await ctx.reply('Configured bot administrators cannot be moderated with this command.');
    return;
  }

  const chatId = ctx.chat.id;
  const hours = duration ? Number(duration) : undefined;
  const untilDate = hours === undefined ? undefined : Math.floor(Date.now() / 1000) + hours * 60 * 60;
  try {
    const member = await ctx.api.getChatMember(chatId, replyTarget.id);
    if (member.status === 'creator' || member.status === 'administrator') {
      await ctx.reply('Group administrators cannot be moderated with this command.');
      return;
    }

    if (action === 'ban') {
      if (untilDate === undefined) {
        await ctx.api.banChatMember(chatId, replyTarget.id);
      } else {
        await ctx.api.banChatMember(chatId, replyTarget.id, { until_date: untilDate });
      }
    } else {
      await ctx.api.restrictChatMember(chatId, replyTarget.id, NO_CHAT_PERMISSIONS, {
        until_date: untilDate!,
        use_independent_chat_permissions: true,
      });
    }

  } catch (error) {
    logger.warn('Group moderation action failed', {
      action,
      chatId,
      targetUserId: replyTarget.id,
      adminUserId: ctx.from?.id,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await ctx.reply(`Could not apply /${action}. Check that the bot has permission to restrict members in this group.`);
    } catch {
      // Telegram may reject the response in addition to the moderation API request.
    }
    return;
  }

  logger.info('Admin applied group moderation', {
    action,
    chatId,
    targetUserId: replyTarget.id,
    permanent: permanentBan,
    durationHours: hours,
    untilDate,
    adminUserId: ctx.from?.id,
  });
  const displayName = [replyTarget.first_name, replyTarget.last_name].filter(Boolean).join(' ') || 'Member';
  try {
    const result = action === 'ban'
      ? permanentBan ? 'permanently banned from the group' : `banned from the group for ${hours} hours`
      : `muted for ${hours} hours`;
    await ctx.reply(`${displayName} has been ${result}.`);
  } catch (error) {
    logger.warn('Moderation action succeeded but confirmation could not be sent', {
      action,
      chatId,
      targetUserId: replyTarget.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function handleAdminBan(ctx: Context): Promise<void> {
  return handleModeration(ctx, 'ban');
}

export function handleAdminLimit(ctx: Context): Promise<void> {
  return handleModeration(ctx, 'limit');
}
