"l": {
  aliases: ["dump", "analyze", "log", "unveilr"],
  description: "Analyzes an attached Lua file and returns a detailed JSON report.",
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

    const fs = require('fs').promises;
    const path = require('path');
    const os = require('os');
    const { request } = require('./fetcher');
    const LuaDumper = require('./dumper/lua-dumper');
    const { AttachmentBuilder } = require('discord.js');

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
        await msg.author.send(`❌ **Analysis Error:**\n\`\`\`\n${result.error}\n\`\`\``).catch(() => {});
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
  })
}
