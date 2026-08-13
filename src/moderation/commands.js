const { getGroupSettings, updateGroupSettings } = require('./store');

function isAdminCommand(text) {
  return /^\/(antilink|antidelete|antimention|welcome)\b/i.test(text?.trim() || '');
}

async function handleCommand(sock, msg, { isAdmin, isBotAdmin } = {}) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return false;

  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  ).trim();

  if (!isAdminCommand(text)) return false;

  if (!isAdmin && !isBotAdmin) {
    await sock.sendMessage(remoteJid, {
      text: '⛔ Only group admins can use this command.',
    });
    return true;
  }

  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  const reply = (t) => sock.sendMessage(remoteJid, { text: t });

  switch (cmd) {
    case '/antilink': {
      const state = parseOnOff(args[0]);
      if (state === null) {
        const s = getGroupSettings(remoteJid);
        return void (await reply(`antilink is currently ${s.antilink ? 'ON ✅' : 'OFF ❌'}. Use /antilink on|off`));
      }
      updateGroupSettings(remoteJid, { antilink: state });
      await reply(`antilink turned ${state ? 'ON ✅' : 'OFF ❌'}.`);
      return true;
    }

    case '/antidelete': {
      const state = parseOnOff(args[0]);
      if (state === null) {
        const s = getGroupSettings(remoteJid);
        return void (await reply(`antidelete is currently ${s.antidelete ? 'ON ✅' : 'OFF ❌'}. Use /antidelete on|off`));
      }
      updateGroupSettings(remoteJid, { antidelete: state });
      await reply(`antidelete turned ${state ? 'ON ✅' : 'OFF ❌'}.`);
      return true;
    }

    case '/antimention': {
      const state = parseOnOff(args[0]);
      const limitArg = parseInt(args[1], 10);
      const patch = {};
      if (state !== null) patch.antimention = state;
      if (!Number.isNaN(limitArg) && limitArg > 0) patch.antimentionLimit = limitArg;

      if (Object.keys(patch).length === 0) {
        const s = getGroupSettings(remoteJid);
        return void (await reply(
          `antimention is currently ${s.antimention ? 'ON ✅' : 'OFF ❌'}, limit ${s.antimentionLimit}. Use /antimention on|off [limit]`
        ));
      }
      const updated = updateGroupSettings(remoteJid, patch);
      await reply(`antimention turned ${updated.antimention ? 'ON ✅' : 'OFF ❌'}, limit set to ${updated.antimentionLimit}.`);
      return true;
    }

    case '/welcome': {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'set') {
        const message = text.replace(/^\/welcome\s+set\s+/i, '');
        if (!message) return void (await reply('Usage: /welcome set <message>. Use {mention} and {group} as placeholders.'));
        updateGroupSettings(remoteJid, { welcomeMessage: message });
        await reply('✅ Welcome message updated.');
        return true;
      }

      if (sub === 'goodbye') {
        const rest = text.replace(/^\/welcome\s+goodbye\s*/i, '');
        if (!rest || rest.toLowerCase() === 'off') {
          updateGroupSettings(remoteJid, { goodbyeMessage: null });
          await reply('✅ Goodbye message disabled.');
        } else {
          updateGroupSettings(remoteJid, { goodbyeMessage: rest });
          await reply('✅ Goodbye message updated.');
        }
        return true;
      }

      const state = parseOnOff(args[0]);
      if (state === null) {
        const s = getGroupSettings(remoteJid);
        return void (await reply(`welcome is currently ${s.welcome ? 'ON ✅' : 'OFF ❌'}. Use /welcome on|off, /welcome set <msg>, /welcome goodbye <msg>`));
      }
      updateGroupSettings(remoteJid, { welcome: state });
      await reply(`welcome messages turned ${state ? 'ON ✅' : 'OFF ❌'}.`);
      return true;
    }

    default:
      return false;
  }
}

function parseOnOff(arg) {
  if (!arg) return null;
  const v = arg.toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return null;
}

module.exports = { handleCommand, isAdminCommand };
