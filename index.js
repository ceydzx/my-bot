const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { request } = require('./fetcher');
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
        { name: '.get <url> [proxy]', value: 'Fetches content from a URL with optional proxy support.\n**Example 1:** `.get https://api.roblox.com`\n**Example 2:** `.get https://api.roblox.com http://127.0.0.1:8080`' },
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
});

client.login(process.env.DISCORD_TOKEN);
