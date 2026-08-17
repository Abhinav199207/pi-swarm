export type OutboundPolicy = "disabled" | "replies_only" | "allowlisted_only";

export function authorizeTelegramUser(input: {
  allowedUserIds: string[];
  allowedChatIds: string[];
  allowGroupChats: boolean;
  userId: string;
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
}): boolean {
  if (!input.allowedUserIds.includes(input.userId) || !input.allowedChatIds.includes(input.chatId)) {
    return false;
  }
  if (input.chatType === "private") {
    return true;
  }
  return input.allowGroupChats;
}
