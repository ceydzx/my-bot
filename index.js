// @ts-check

const Database = require('better-sqlite3');
const db = new Database('./pub_bot.db');

db.exec(`CREATE TABLE IF NOT EXISTS users (userId TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS botData (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS codes (
    key TEXT PRIMARY KEY,
    redeemed INTEGER DEFAULT 0,
    generatedAt INTEGER,
    type TEXT,
    metadata TEXT
) WITHOUT ROWID`)

require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    Partials,
    Message,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    REST,
    Routes,
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    User,
    GuildMember,
    Emoji,
    ChannelType,
    Guild,
    WebhookClient
} = require('discord.js');

const {
    spawn,
    ChildProcess,
    fork,
    spawnSync
} = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const archiver = require("archiver")
const crypto = require('crypto');
const LuaDumper = require('./dumper/lua-dumper');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

const PREFIX = ".";

const bot = {
    prefix: ".",
    token: process.env.token,
};

client.once('ready', () => {
    console.log(`[ONLINE] Logged in as ${client.user.tag}`);
});

/** @param {string} userId */
const getUserData = (userId) => {
    if (typeof userId != "string")
        return userId;

    const row = db.prepare('SELECT data FROM users WHERE userId = ?').get(userId);

    if (row) {
        return JSON.parse(row.data);
    } else {
        const newUser = {
            settings: {},
            credits: [0, 0],
            verified: false,
            premium: false
        };
        db.prepare('INSERT INTO users (userId, data) VALUES (?, ?)').run(userId, JSON.stringify(newUser));
        return newUser;
    }
};

/** @param {string} userId @param {object} userData */
const setUserData = (userId, userData) => {
    db.prepare('INSERT OR REPLACE INTO users (userId, data) VALUES (?, ?)').run(userId, JSON.stringify(userData))
}

/**
 * @template T
 * @param {(msg: Message, author: string, userData: Record<string, any>) => T} fn
*/
const command = (fn) => fn

const { existsSync, writeFileSync, readFileSync, unlink, createWriteStream, createReadStream } = require('fs');

/** @type {Record<string, Object<string, any>>} */
const configs = {}

/**
 * @typedef {object} Command
 * @property {string[]} aliases
 * @property {string} description
 * @property {(msg: Message, author: string, userData: Record<string, any>) => any} callback
 * @property {boolean} [modonly]
 * @property {number?} [cooldown]
 * @property {string?} [name]
 * @property {number?} [tier]
 */

/** @type {Record<string, Command>} */
const commands = {
    "help": {
        aliases: ["h", "cmds"],
        description: "Shows all available commands",
        callback: command(async (msg) => {
            const embeds = [];
            const commandList = [];

            for (let cmdName in commands) {
                const cmd = commands[cmdName];
                commandList.push(`**${bot.prefix}${cmdName}** (${cmd.aliases.join(", ")}) - ${cmd.description}`);
            }

            const embed = new EmbedBuilder()
                .setTitle("📚 Available Commands")
                .setDescription(commandList.join("\n"))
                .setColor("Blurple")
                .setTimestamp();

            await msg.reply({ embeds: [embed] });
        }),
        cooldown: 5
    },

    "ping": {
        aliases: ["pong"],
        description: "Check bot latency",
        callback: command(async (msg) => {
            await msg.reply(`🏓 Pong! ${client.ws.ping}ms`);
        })
    },

    "l": {
        aliases: ["dump", "analyze", "log", "unveilr"],
        description: "Analyzes an attached Lua file and returns a detailed JSON report. Use `.l deobf` to decode Base64 strings.",
        callback: command(async (msg, a, userData) => {
            if (!msg.attachments || msg.attachments.size === 0) {
                return msg.reply('❌ **Error:** Please attach a Lua file to analyze.\n-# Example: `.l` with an attached `.lua` file\n-# Use `.l deobf` to decode Base64 strings');
            }

            const attachment = msg.attachments.first();
            let filename = attachment.name || attachment.filename || 'file.lua';
            const deobfuscate = msg.content.toLowerCase().includes('deobf');
            
            if (!filename.toLowerCase().endsWith('.lua')) {
                filename = filename + '.lua';
            }

            const { request } = require('./fetcher');
            const tmpdir = path.join(os.tmpdir(), 'dumper-' + Math.random().toString(36).substring(7));
            const filepath = path.join(tmpdir, filename);

            try {
                await fs.mkdir(tmpdir, { recursive: true });

                const statusMsg = await msg.reply(`⏳ **Analyzing Lua file...${deobfuscate ? '\n🔓 Decoding Base64 strings...' : ''}\n**-# This may take a moment.`);

                // Download file
                const [ok, content] = await request(attachment.url);
                if (!ok) {
                    throw new Error('Failed to download file from Discord');
                }

                await fs.writeFile(filepath, content, 'utf8');

                // Analyze with LuaDumper
                const dumper = new LuaDumper();
                const result = dumper.analyze(filepath, 'full', deobfuscate);
                const summary = dumper.summary([result]);

                if (result.error) {
                    try {
                        await msg.author.send(`❌ **Analysis Error:**\n\`\`\`\n${result.error}\n\`\`\``);
                    } catch (e) {}
                    return statusMsg.edit('❌ **Analysis failed!** Sent error details to your DMs.');
                }

                // Create JSON report
                const reportData = {
                    summary,
                    result,
                    timestamp: new Date().toISOString(),
                };

                const buffer = Buffer.from(JSON.stringify(reportData, null, 2), 'utf8');
                const attachFile = new AttachmentBuilder(buffer, { name: filename + '.report.json' });
                
                // Create summary message
                let summaryText = `✅ **Analysis Complete**
        
📊 **Summary:**
• Files analyzed: \`${summary.files_analyzed}\`
• Functions found: \`${summary.total_functions}\`
• Strings extracted: \`${summary.total_strings}\`
• Base64 strings found: \`${summary.base64_strings_found}\`
• Code patterns found: \`${Object.values(result.patterns).reduce((sum, arr) => sum + arr.length, 0)}\`
• Obfuscated: ${summary.obfuscated_files > 0 ? '⚠️ **Yes**' : '✅ **No**'}
• Obfuscation confidence: \`${result.metrics.is_obfuscated.confidence}%\`

📈 **Metrics:**
• Total lines: \`${result.metrics.lines}\`
• Characters: \`${result.metrics.chars}\`
• MD5: \`${result.metrics.md5}\`
• SHA256: \`${result.metrics.sha256}\``;

                if (deobfuscate && result.base64Decoded && result.base64Decoded.length > 0) {
                    summaryText += `\n\n🔓 **Base64 Decoded Strings:** \`${result.base64Decoded.length}\` found\n`;
                    result.base64Decoded.slice(0, 5).forEach((item, i) => {
                        summaryText += `${i + 1}. \`${item.original.substring(0, 30)}...\` → \`${item.decoded.substring(0, 40)}...\`\n`;
                    });
                    if (result.base64Decoded.length > 5) {
                        summaryText += `... and ${result.base64Decoded.length - 5} more`;
                    }
                }

                summaryText += `\n\n📁 **Report:** Attached as JSON file`;

                try {
                    await msg.author.send({
                        content: summaryText,
                        files: [attachFile]
                    });
                    
                    await statusMsg.edit('✅ **Analysis complete!** Check your DMs for the detailed report.');
                } catch (dmError) {
                    await statusMsg.edit('❌ **Unable to send DM!** Make sure your DMs are enabled.');
                }

            } catch (err) {
                console.error('Dumper error:', err);
                await statusMsg.edit(`❌ **Error:** ${err.message}`);
            } finally {
                try {
                    const fs_sync = require('fs');
                    if (fs_sync.existsSync(tmpdir)) {
                        fs_sync.rmSync(tmpdir, { recursive: true, force: true });
                    }
                } catch (e) {
                    console.error('Cleanup error:', e);
                }
            }
        }),
        cooldown: 10
    }
};

/**
 * @param {string} name
 */
const getCommand = (name) => {
    name = name.toLowerCase();

    for (let commandName in commands) {
        const command = commands[commandName]
        if (commandName === name || command.aliases.includes(name)) {
            command.name = commandName;
            return command
        };
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content;
    const author = message.author.id.toString();

    if (content.substring(0, 1) != bot.prefix) return;

    const args = content.slice(bot.prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    const command = getCommand(cmd);

    if (command) {
        const userData = getUserData(author);

        if (command.cooldown) {
            const lastUses = userData.cooldowns ??= {};
            const lastUse = lastUses[command.name];
            const difference = lastUse && Date.now() - lastUse || Infinity;
            
            if (difference < (command.cooldown * 1000)) {
                const m = await message.reply(`⏱️ You are on cooldown. (${(command.cooldown - difference / 1000).toFixed(2)} seconds left)`);
                setTimeout(() => m.delete(), 3000);
                return;
            }

            lastUses[command.name] = Date.now();
            setUserData(author, userData);
        }

        return command.callback(message, author, userData);
    }

    await message.reply("❌ Command not found. Use `.help` to see available commands.");
});

client.login(bot.token);
