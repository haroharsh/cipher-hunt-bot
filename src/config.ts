import 'dotenv/config';

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const bool = (v?: string) => (v ?? '').toLowerCase() === 'true';

export const config = {
  token: process.env.DISCORD_TOKEN ?? '',
  prefix: './',
  adminUserIds: list(process.env.ADMIN_USER_IDS),
  adminRoleIds: list(process.env.ADMIN_ROLE_IDS),
  adminChannelId: process.env.ADMIN_CHANNEL_ID || null,
  leaderboardChannelId: process.env.LEADERBOARD_CHANNEL_ID || null,
  logChannelId: process.env.LOG_CHANNEL_ID || null,
  imagesDir: process.env.IMAGES_DIR ?? './images',
  normalize: {
    collapseSpaces: bool(process.env.NORMALIZE_COLLAPSE_SPACES),
    stripSpaces: bool(process.env.NORMALIZE_STRIP_SPACES),
    stripPunctuation: bool(process.env.NORMALIZE_STRIP_PUNCTUATION),
  },
};
