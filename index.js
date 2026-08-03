const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { request } = require('./fetcher');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
      .setDescription('Available commands:')
      .addFields(
        { name: '.get <url> [proxy]', value: 'Fetches content from a URL with optional proxy support.\n**Example 1:** `.get https://api.roblox.com`\n**Example 2:** `.get https://api.roblox.com proxy`' },
        { name: '.l [mode]', value: 'Analyzes an attached Lua file and returns a JSON report.\n**Modes:** `full` (default), `strings`, `patterns`\n**Example:** `.l full` with an attached file' },
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
      return message.reply('❌ **Error:** Please provide a URL. Example: `.get https://api.roblox.com`');
    }

    const statusMsg = await message.reply('⏳ **Fetching... sent to your DMs**');

    try {
      const [success, result] = await request(url, proxy);

      if (success) {
        if (result.length > 2000) {
          if (result.length > 6000) {
            const buffer = Buffer.from(result, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: 'result.txt' });

            await message.author.send({
              content: `✅ **Result for:** ${url} (Attached as .txt because content length is ${result.length} chars):`,
              files: [attachment]
            });
          } else {
            const chunks = result.match(/[\s\S]{1,1900}/g) || [result];
            await message.author.send('✅ **Result for:** ' + url + ` (${chunks.length} parts):`);
            for (let i = 0; i < chunks.length; i++) {
              await message.author.send('```js\n' + chunks[i] + '\n```');
            }
          }
        } else {
          await message.author.send('✅ **Result for:** ' + url + '\n```js\n' + result + '\n```');
        }
      } else {
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
      if (err.code === 50007 || err.message?.includes('Cannot send messages')) {
        return statusMsg.edit('⛔ **Your DMs are disabled!** Please enable "Allow direct messages from server members" in User Settings > Privacy & Safety so I can send you the result.');
      }

      console.error('Unexpected error:', err);
      statusMsg.edit('❌ **An error occurred while processing your request.**');
    }
  }

  // New dumper command: .l (Lua dumper - supports ESM Pipeline if project is ESM; otherwise falls back to CommonJS lua-dumper)
  if (command === 'l') {
    const mode = args[0] || 'full';

    if (!message.attachments || message.attachments.size === 0) {
      return message.reply('❌ **Error:** Please attach a file to analyze.');
    }

    const attachment = message.attachments.first();
    let filename = attachment.name || attachment.filename || 'file.lua';

    if (!filename.toLowerCase().endsWith('.lua')) {
      filename = filename + '.lua';
    }

    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dumper-'));
    const filepath = path.join(tmpdir, filename);

    const statusMsg = await message.reply('⏳ **Analyzing file... I will DM you the JSON report when ready.**');

    try {
      const [ok, content] = await request(attachment.url);
      if (!ok) {
        throw new Error('Failed to download attachment');
      }

      fs.writeFileSync(filepath, content, 'utf8');

      // Decide whether to use ESM Pipeline (if package.json is "type":"module") or fallback to CommonJS dumper
      let usedImpl = 'fallback-cjs';
      let result = null;
      let summary = null;

      try {
        const pkgPath = path.join(__dirname, 'package.json');
        let isModule = false;
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            isModule = pkg.type === 'module';
          } catch (e) {
            // ignore parse errors, keep isModule false
          }
        }

        // If project is ESM and Main.js exists, try dynamic import of Pipeline
        if (isModule) {
          const mainPath = path.join(__dirname, 'dumper', 'Main.js');
          if (fs.existsSync(mainPath)) {
            try {
              // dynamic import; this will work only when package.json type=module
              const mod = await import('./dumper/Main.js');
              if (mod?.Pipeline) {
                usedImpl = 'esm-pipeline';
                const pipe = new mod.Pipeline();
                result = await pipe.analyze(filepath, mode);
                summary = pipe.summary([result]);
              }
            } catch (e) {
              console.error('Failed to import ESM Pipeline:', e);
              // fall through to fallback
            }
          }
        }
      } catch (e) {
        console.error('Pipeline detection error:', e);
      }

      // Fallback to the existing CommonJS lua-dumper implementation if we didn't get a result
      if (!result) {
        try {
          const LuaDumper = require('./dumper/lua-dumper');
          const dumper = new LuaDumper();
          // lua-dumper's analyze is synchronous; guard for Promise just in case
          result = dumper.analyze(filepath, mode);
          if (result instanceof Promise) result = await result;
          summary = dumper.summary([result]);
          usedImpl = usedImpl === 'esm-pipeline' ? usedImpl : 'fallback-cjs';
        } catch (e) {
          // If require failed, surface error
          throw new Error(`Failed to load dumper implementation: ${e.message}`);
        }
      }

      if (result.error) {
        await message.author.send(`❌ Analysis error:\n\`\`\`\n${result.error}\n\`\`\``);
        await statusMsg.edit('❌ Analysis failed; sent error details to your DMs.');
      } else {
        const reportData = {
          implementation: usedImpl,
          summary,
          result,
          timestamp: new Date().toISOString(),
        };

        const buffer = Buffer.from(JSON.stringify(reportData, null, 2), 'utf8');
        const attachFile = new AttachmentBuilder(buffer, { name: filename + '.report.json' });

        const summaryText = `✅ **Analysis Complete**
        
📊 **Summary:**
• Files analyzed: ${summary.files_analyzed || summary.files || 1}
• Functions found: ${summary.total_functions || 0}
• Strings found: ${summary.total_strings || 0}
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

      if (err.code === 50007 || err.message?.includes('Cannot send messages')) {
        return statusMsg.edit('⛔ **Your DMs are disabled!** Please enable DMs so I can send the report.');
      }

      await statusMsg.edit(`❌ Error: ${err.message}`);
    } finally {
      try { fs.unlinkSync(filepath); } catch (e) {}
      try { fs.rmdirSync(tmpdir); } catch (e) {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);        { name: '.l [mode]', value: 'Analyzes an attached Lua file and returns a JSON report.\n**Modes:** `full` (default), `strings`, `patterns`\n**Example:** `.l full` with an attached file' },
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
      return message.reply('❌ **Error:** Please provide a URL. Example: `.get https://api.roblox.com`');
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

  // New dumper command: .l (Lua dumper - Node.js only, no Python needed)
  if (command === 'l') {
    const mode = args[0] || 'full';

    if (!message.attachments || message.attachments.size === 0) {
      return message.reply('❌ **Error:** Please attach a file to analyze.');
    }

    const attachment = message.attachments.first();
    let filename = attachment.name || attachment.filename || 'file.lua';
    
    // Ensure filename has .lua extension for processing
    if (!filename.toLowerCase().endsWith('.lua')) {
      filename = filename + '.lua';
    }

    // create temp directory
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dumper-'));
    const filepath = path.join(tmpdir, filename);

    const statusMsg = await message.reply('⏳ **Analyzing file... I will DM you the JSON report when ready.**');

    try {
      // download attachment
      const [ok, content] = await request(attachment.url);
      if (!ok) {
        throw new Error('Failed to download attachment');
      }

      fs.writeFileSync(filepath, content, 'utf8');

      // Use Node.js-based Lua dumper (no Python needed!)
      const dumper = new LuaDumper();
      const result = dumper.analyze(filepath, mode);
      const summary = dumper.summary([result]);

      if (result.error) {
        // File read or analysis error
        await message.author.send(`❌ Analysis error:\n\`\`\`\n${result.error}\n\`\`\``);
        await statusMsg.edit('❌ Analysis failed; sent error details to your DMs.');
      } else {
        // Success - send JSON report
        const reportData = {
          summary,
          result,
          timestamp: new Date().toISOString(),
        };

        const buffer = Buffer.from(JSON.stringify(reportData, null, 2), 'utf8');
        const attachFile = new AttachmentBuilder(buffer, { name: filename + '.report.json' });
        
        // Also send a text summary
        const summaryText = `✅ **Analysis Complete**
        
📊 **Summary:**
• Files analyzed: ${summary.files_analyzed}
• Functions found: ${summary.total_functions}
• Strings found: ${summary.total_strings}
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
      
      // DM disabled handling
      if (err.code === 50007 || err.message?.includes('Cannot send messages')) {
        return statusMsg.edit('⛔ **Your DMs are disabled!** Please enable DMs so I can send the report.');
      }
      
      await statusMsg.edit(`❌ Error: ${err.message}`);
    } finally {
      // cleanup
      try { fs.unlinkSync(filepath); } catch (e) {}
      try { fs.rmdirSync(tmpdir); } catch (e) {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
