require('dotenv').config();

console.log('[STARTUP] node process started (dumper debug enabled)');
const hasToken = !!process.env.DISCORD_TOKEN;
console.log('[STARTUP] DISCORD_TOKEN present:', hasToken ? 'yes' : 'no');
const ownerEnv = process.env.BOT_OWNER_ID;
console.log('[STARTUP] BOT_OWNER_ID present:', ownerEnv ? 'yes' : 'no');

process.on('unhandledRejection', (reason, p) => {
  console.error('[UNHANDLED_REJECTION]', reason, p);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT_EXCEPTION]', err && err.stack ? err.stack : err);
});
