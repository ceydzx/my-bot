const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { request } = require('./fetcher');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
require('dotenv').config();

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
  console.log(`[ONLINE] Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Command handlers (.help and !help)
  if (message.content === '.help' || message.content === '!help') {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 Discord Fetcher Bot Commands')
      .setDescription('Naglalaman ng listahan ng mga available na command:')
      .addFields(
        { name: '.get <url> [proxy]', value: 'Fetches content from a URL with optional proxy support.\n**Example 1:** `.get https://api.roblox.com`\n**Example 2:** `.get https://api.roblox.com htt[...]' },
        { name: '.help or !help', value: 'Shows this help message.' }
      )
      .setFooter({ text: 'Discord.js v14 Bot • Direct Message Results' })
      .setTimestamp();

    return message.reply({ embeds: [helpEmbed] });
  }

  // Check prefix
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'get') {
    const url = args[0];
    const proxy = args[1];

    if (!url) {
      return message.reply('❌ **Error:** Pakilagay ang URL. Example: `.get https://api.roblox.com`');
    }

    // Step 1: Notify in server channel
    const statusMsg = await message.reply('⏳ **Fetching... sent to your DMs**');

    // Step 2: Try DMing the user first to verify DMs are open
    try {
      // Perform request
      const [success, result] = await request(url, proxy);

      if (success) {
        // Send success payload via DM
        if (result.length > 2000) {
          // If result is very long, attach as file or split
          if (result.length > 6000) {
            const buffer = Buffer.from(result, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: 'result.txt' });

            await message.author.send({
              content: `✅ **Result for:** ${url} (Attached as .txt because content length is ${result.length} chars):`,
              files: [attachment]
            });
          } else {
            // Split into multiple chunks of ~1900 chars
            const chunks = result.match(/[\s\S]{1,1900}/g) || [result];
            await message.author.send('✅ **Result for:** ' + url + ` (${chunks.length} parts):`);
            for (let i = 0; i < chunks.length; i++) {
              await message.author.send('```js\n' + chunks[i] + '\n```');
            }
          }
        } else {
          // Standard length message
          await message.author.send('✅ **Result for:** ' + url + '\n```js\n' + result + '\n```');
        }
      } else {
        // Request failed, send Red Embed to DM
        const errorEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Fetch Error')
          .setDescription(result)
          .addFields(
            { name: 'Requested URL', value: '```' + url + '```' },
            { name: 'Proxy Used', value: proxy ? '```' + proxy + '```' : 'None' }
          )
          .setTimestamp();

        await message.author.send({ embeds: [errorEmbed] });
      }

    } catch (err) {
      // Catch DM Disabled error (Discord API Error Code 50007: Cannot send messages to this user)
      if (err.code === 50007 || err.message?.includes('Cannot send messages')) {
        return statusMsg.edit('⛔ **Your DMs are disabled!** Please enable "Allow direct messages from server members" in User Settings > Privacy & Safety so I can send you the result.');
      }

      console.error('Unexpected error:', err);
      statusMsg.edit('❌ **An error occurred while processing your request.**');
    }
  }

  // New dumper command: .l
  if (command === 'l') {
    const mode = args[0] || 'full';

    if (!message.attachments || message.attachments.size === 0) {
      return message.reply('❌ **Error:** Please attach a .lua file to analyze. Example: `.l` with an attached file.');
    }

    const attachment = message.attachments.first();
    const filename = attachment.name || attachment.filename || 'file.lua';

    if (!filename.toLowerCase().endsWith('.lua')) {
      return message.reply('❌ **Error:** The attached file must be a .lua file.');
    }

    // create temp directory
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dumper-'));
    const filepath = path.join(tmpdir, filename);

    const statusMsg = await message.reply('⏳ **Analyzing file... I will DM you the JSON report when ready.**');

    try {
      // download attachment using existing request helper
      const [ok, content] = await request(attachment.url);
      if (!ok) {
        throw new Error('Failed to download attachment');
      }

      fs.writeFileSync(filepath, content, 'utf8');

      // run python dumper
      // Try python3 then python
      let pyCmd = 'python3';
      let proc = spawnSync(pyCmd, ['dumper/run_dumper.py', filepath, mode], { encoding: 'utf8', timeout: 20000 });
      if (proc.status !== 0) {
        // try fallback
        pyCmd = 'python';
        proc = spawnSync(pyCmd, ['dumper/run_dumper.py', filepath, mode], { encoding: 'utf8', timeout: 20000 });
      }

      if (proc.error) throw proc.error;

      if (proc.status !== 0) {
        // Send error DM with stderr
        const errText = proc.stderr || proc.stdout || 'Unknown error';
        await message.author.send(`❌ Dumper failed:\n\n${errText}`);
        await statusMsg.edit('❌ Analysis failed; sent error to your DMs.');
      } else {
        const outJson = proc.stdout;
        const buffer = Buffer.from(outJson, 'utf8');
        const attachFile = new AttachmentBuilder(buffer, { name: filename + '.report.json' });
        await message.author.send({ content: `✅ Analysis result for ${filename} (mode=${mode})`, files: [attachFile] });
        await statusMsg.edit('✅ Analysis complete — I sent the report to your DMs.');
      }

    } catch (err) {
      console.error('Dumper error:', err);
      // DM disabled handling
      if (err.code === 50007 || err.message?.includes('Cannot send messages')) {
        return statusMsg.edit('⛔ **Your DMs are disabled!** Please enable DMs so I can send the report.');
      }
      await statusMsg.edit('❌ An error occurred while analyzing the file.');
    } finally {
      // cleanup
      try { fs.unlinkSync(filepath); } catch (e) {}
      try { fs.rmdirSync(tmpdir); } catch (e) {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
