import { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// ESM helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically load fetcher so this works if fetcher.js is CommonJS or ESM
async function loadFetcher() {
  const mod = await import('./fetcher.js');
  // Try reasonable exports
  if (typeof mod.request === 'function') return mod;
  if (mod.default && typeof mod.default.request === 'function') return mod.default;
  // Fallback: if module itself is the function
  if (typeof mod === 'function') return { request: mod };
  throw new Error('fetcher.js does not export a request() function');
}

const fetcher = await loadFetcher();
const { request } = fetcher;

// Import the Pipeline from your dumper (ESM)
import { Pipeline } from './dumper/Main.js';

import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const PREFIX = '.';

client.once('ready', () => {
  console.log(`[ONLINE] Logged in as ${client.user?.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author?.bot) return;

  // Help
  if (message.content === '.help' || message.content === '!help') {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 Discord Fetcher Bot Commands')
      .setDescription('Available commands:')
      .addFields(
        { name: '.get <url> [proxy]', value: 'Fetches content from a URL with optional proxy support.' },
        { name: '.l [mode]', value: 'Analyzes an attached Lua file and returns a JSON report. Modes: full (default), strings, patterns' },
        { name: '.help or !help', value: 'Shows this help message.' }
      )
      .setFooter({ text: 'Discord.js v14 Bot • Direct Message Results' })
      .setTimestamp();

    return message.reply({ embeds: [helpEmbed] });
  }

  // Only handle commands with prefix
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // GET command (unchanged; uses fetcher.request)
  if (command === 'get') {
    const url = args[0];
    const proxy = args[1];

    if (!url) return message.reply('❌ **Error:** Please provide a URL. Example: `.get https://api.roblox.com`');

    const statusMsg = await message.reply('⏳ **Fetching... sent to your DMs**');

    try {
      const [success, result] = await request(url, proxy);

      if (success) {
        if (typeof result === 'string' && result.length > 2000) {
          if (result.length > 6000) {
            const buffer = Buffer.from(result, 'utf8');
            const attachment = new AttachmentBuilder(buffer, { name: 'result.txt' });
            await message.author.send({
              content: `✅ **Result for:** ${url} (Attached as .txt)`,
              files: [attachment]
            });
          } else {
            const chunks = result.match(/[\s\S]{1,1900}/g) || [result];
            await message.author.send('✅ **Result for:** ' + url + ` (${chunks.length} parts):`);
            for (const c of chunks) await message.author.send('```js\n' + c + '\n```');
          }
        } else {
          await message.author.send('✅ **Result for:** ' + url + '\n```js\n' + String(result) + '\n```');
        }
      } else {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Fetch Error')
          .setDescription(String(result))
          .addFields(
            { name: 'Requested URL', value: `\`\`\`${url}\`\`\`` },
            { name: 'Proxy Used', value: proxy ? `\`\`\`${proxy}\`\`\`` : 'None' }
          )
          .setTimestamp();
        await message.author.send({ embeds: [errorEmbed] });
      }
    } catch (err) {
      if (err?.code === 50007 || String(err).includes('Cannot send messages')) {
        return statusMsg.edit('⛔ **Your DMs are disabled!** Please enable DMs so I can send you the result.');
      }
      console.error('Unexpected error:', err);
      statusMsg.edit('❌ **An error occurred while processing your request.**');
    }
  }

  // Dumper command — uses Pipeline from dumper/Main.js
  if (command === 'l') {
    const mode = args[0] || 'full';

    if (!message.attachments || message.attachments.size === 0) {
      return message.reply('❌ **Error:** Please attach a file to analyze.');
    }

    const attachment = message.attachments.first();
    let filename = attachment.name || attachment.filename || 'file.lua';
    if (!filename.toLowerCase().endsWith('.lua')) filename = filename + '.lua';

    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dumper-'));
    const filepath = path.join(tmpdir, filename);

    const statusMsg = await message.reply('⏳ **Analyzing file... I will DM you the JSON report when ready.**');

    try {
      const [ok, content] = await request(attachment.url);
      if (!ok) throw new Error('Failed to download attachment');

      fs.writeFileSync(filepath, content, 'utf8');

      // Use the ESM Pipeline from dumper/Main.js
      const pipe = new Pipeline();
      const result = await pipe.analyze(filepath, mode);
      const summary = pipe.summary([result]);

      if (result.error) {
        await message.author.send(`❌ Analysis error:\n\`\`\`\n${result.error}\n\`\`\``);
        await statusMsg.edit('❌ Analysis failed; sent error details to your DMs.');
      } else {
        const reportData = {
          implementation: 'esm-pipeline',
          summary,
          result,
          timestamp: new Date().toISOString(),
        };

        const buffer = Buffer.from(JSON.stringify(reportData, null, 2), 'utf8');
        const attachFile = new AttachmentBuilder(buffer, { name: filename + '.report.json' });

        const summaryText = `✅ **Analysis Complete**
        
📊 **Summary:**
• Files analyzed: ${summary.files || summary.files_analyzed || 1}
• Functions found: ${summary.total_functions || 0}
• Strings found: ${summary.total_strings || summary.strings || 0}
• Obfuscated: ${summary.obfuscated_files > 0 ? '⚠️ Yes' : '✅ No'}
• Mode: ${mode}

📁 Attached: \`${filename}.report.json\``;

        await message.author.send({
          content: summaryText,
          files: [attachFile]
        });

        await statusMsg.edit('✅ Analysis complete — I sent the report to your DMs.');
      }

    } catch (err) {
      console.error('Dumper error:', err);
      if (err?.code === 50007 || String(err).includes('Cannot send messages')) {
        return statusMsg.edit('⛔ **Your DMs are disabled!** Please enable DMs so I can send the report.');
      }
      await statusMsg.edit(`❌ Error: ${err.message || String(err)}`);
    } finally {
      try { fs.unlinkSync(filepath); } catch (e) {}
      try { fs.rmdirSync(tmpdir); } catch (e) {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
