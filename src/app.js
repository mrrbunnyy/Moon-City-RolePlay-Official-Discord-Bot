import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  Client, Collection, GatewayIntentBits, PermissionFlagsBits,
  SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
  ChannelType
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const BUNNY_ID = process.env.BUNNY_ID;
if (!TOKEN || !CLIENT_ID) throw new Error('DISCORD_TOKEN and CLIENT_ID are required.');

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'mcrp.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { guilds: {} };
try { if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { db = { guilds: {} }; }
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
const guildData = (id) => db.guilds[id] ||= {
  setup: { panelChannelId:null, leaderChannelId:null, curatorChannelId:null, panelMessageId:null, publicPanelMessageId:null },
  templates: {
    leaderAppointed:'{user} has been appointed as the Leader of {organization}.',
    leaderComplete:'{user} has completed their term as Leader of {organization}.',
    leaderFired:'{user} has been removed/fired from their Leader position of {organization}.',
    curatorAppointed:'{user} has been selected/appointed as Curator of {organization}.',
    curatorFired:'{user} has been removed/fired from their Curator position of {organization}.',
    curatorTransfer:'{user} has been transferred from {organization} to {organization2}.'
  },
  logChannelId:null, lockRoleId:null, lockOverwrites:{}, afk:null, autoTag:{enabled:false,channelId:null}, welcomed:[]
};
const log = async (guild, action, details='') => {
  const d = guildData(guild.id); if (!d.logChannelId) return;
  const ch = guild.channels.cache.get(d.logChannelId); if (!ch?.isTextBased()) return;
  const e = new EmbedBuilder().setTitle('MCRP Bot Log').setColor(0x2f80ed).addFields(
    {name:'Action',value:String(action).slice(0,1024),inline:true},
    {name:'Details',value:String(details || 'None').slice(0,1024),inline:false},
    {name:'Time',value:`<t:${Math.floor(Date.now()/1000)}:F>`,inline:false}
  ); try { await ch.send({embeds:[e]}); } catch {}
};
const admin = i => i.memberPermissions?.has(PermissionFlagsBits.Administrator);
const mention = id => `<@${id}>`;
const render = (s, vars) => String(s).replaceAll('{user}',vars.user||'').replaceAll('{organization}',vars.organization||'').replaceAll('{organization2}',vars.organization2||'').replaceAll('{text}',vars.text||'').replaceAll('{description}',vars.description||'');
const roleLabel = (r) => r ? `<@&${r.id}>` : 'Not selected';

const client = new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.DirectMessages]});
client.commands = new Collection();

function command(data, execute) { client.commands.set(data.name, {data, execute}); }

command(new SlashCommandBuilder().setName('help').setDescription('Show Moon City RP bot help'), async i => {
  await i.reply({content:'# 🌙 **MOON CITY RP**\n\n***👋 Hello! I’m the Moon City RP Bot***.\n\n**__Join official server__**\nhttps://discord.gg/T7HGpNb3kn\n\n🌃 **Welcome to Moon City RP — Your City, Your Roleplay.**\n\n━━━━━━━━━━━━━━━━━━\n 💙 **MCRP • Moon City RolePlay**\n\n**Commands:** `/help` `/announce` `/log-set` `/mcrp-lock` `/afk` `/auto-tag`\n**Admin setup:** `!MCRP-MCRP` `!MCRP-EDIT` `!MCRP-DELETE` `!MCRP-LOCK` `!MCRP-UNLOCK` `!lock-role` `!unlock-role`',ephemeral:true});
});
command(new SlashCommandBuilder().setName('announce').setDescription('Send an announcement').addChannelOption(o=>o.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Announcement message').setRequired(true)), async i=>{
  if(!admin(i)) return i.reply({content:'❌ Administrator permission required.',ephemeral:true});
  const ch=i.options.getChannel('channel'); const msg=i.options.getString('message'); await ch.send(msg); await i.reply({content:`✅ Announcement sent to ${ch}.`,ephemeral:true}); await log(i.guild,'Announcement sent',`By ${i.user.tag} in ${ch}`);
});
command(new SlashCommandBuilder().setName('log-set').setDescription('Set the MCRP bot log channel').addChannelOption(o=>o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)), async i=>{
  if(!admin(i)) return i.reply({content:'❌ Administrator permission required.',ephemeral:true}); const d=guildData(i.guild.id); d.logChannelId=i.options.getChannel('channel').id; save(); await i.reply({content:`✅ Log channel set to ${i.options.getChannel('channel')}.`,ephemeral:true}); await log(i.guild,'Log channel updated',`By ${i.user.tag}`);
});
command(new SlashCommandBuilder().setName('mcrp-lock').setDescription('Set the selected role for MCRP lock commands').addRoleOption(o=>o.setName('role').setDescription('Role to lock').setRequired(true)), async i=>{
  if(!admin(i)) return i.reply({content:'❌ Administrator permission required.',ephemeral:true}); const r=i.options.getRole('role'); const d=guildData(i.guild.id); d.lockRoleId=r.id; save(); await i.reply({content:`🔒 Selected lock role: ${r}.\nUse !MCRP-LOCK to lock and !MCRP-UNLOCK to restore it.`,ephemeral:true}); await log(i.guild,'Lock role selected',`${r} by ${i.user.tag}`);
});
command(new SlashCommandBuilder().setName('afk').setDescription('Set Bunny AFK status').addStringOption(o=>o.setName('reason').setDescription('Optional reason')), async i=>{ await setAfk(i.guild,i.user,i.options.getString('reason')||'No reason provided',i); });
command(new SlashCommandBuilder().setName('auto-tag').setDescription('Configure automatic verification-channel tagging').addSubcommand(s=>s.setName('channel').setDescription('Set the verification channel').addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))).addSubcommand(s=>s.setName('on').setDescription('Enable auto-tag')).addSubcommand(s=>s.setName('off').setDescription('Disable auto-tag')), async i=>{
  if(!admin(i)) return i.reply({content:'❌ Administrator permission required.',ephemeral:true}); const d=guildData(i.guild.id), sub=i.options.getSubcommand();
  if(sub==='channel') d.autoTag.channelId=i.options.getChannel('channel').id; if(sub==='on') d.autoTag.enabled=true; if(sub==='off') d.autoTag.enabled=false; save(); await i.reply({content:`✅ Auto-tag ${sub==='channel'?'channel set':sub==='on'?'enabled':'disabled'}.`,ephemeral:true}); await log(i.guild,'Auto-tag settings changed',`By ${i.user.tag}`);
});

function setupPanel() { return {embeds:[new EmbedBuilder().setTitle('🌙 Moon City RP Official Bot').setDescription('Configure the official MCRP Leader and Curator announcement system.\n\nSelect the announcement channels, edit your templates, then press **Send** to publish the public panel.')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mcrp_setup_leader').setLabel('Select Leader Announcement Channel').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('mcrp_setup_curator').setLabel('Select Curator Announcement Channel').setStyle(ButtonStyle.Primary)),new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mcrp_setup_edit').setLabel('Edit Announcement Message').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('mcrp_setup_send').setLabel('Send').setStyle(ButtonStyle.Success))]}; }
function publicPanel(){return {embeds:[new EmbedBuilder().setTitle('🌙 Moon City RP').setDescription('**Official Leader & Curator Announcement System**\n\nUse the buttons below to submit an action. Your form is private and will only be visible to you.\n\nPlease provide accurate information. Staff actions are logged automatically.')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mcrp_leader').setLabel('LEADER').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('mcrp_curator').setLabel('CURATOR').setStyle(ButtonStyle.Secondary))]};}
function editMenu(){
  const opts=['leaderAppointed','leaderComplete','leaderFired','curatorAppointed','curatorFired','curatorTransfer'].map((v,i)=>({label:['Leader Appointed','Leader Complete Term','Leader Fired','Curator Appointed','Curator Fired','Curator Transfer'][i],value:v}));
  return {content:'**MCRP Announcement Templates**\nSelect a template to edit. Changes are saved immediately.',components:[
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('mcrp_template').setPlaceholder('Select a template').addOptions(opts)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mcrp_back_setup').setLabel('Back').setStyle(ButtonStyle.Secondary))
  ]};
}
function actionModal(type){const isLeader=type==='leader'; const m=new ModalBuilder().setCustomId(`mcrp_form_${type}`).setTitle(isLeader?'MCRP LEADERS':'MCRP CURATORS');
  const rows=[new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('mcrp_user').setPlaceholder('Select user').setMinValues(1).setMaxValues(1)),new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('mcrp_org').setPlaceholder('Select organization').setMinValues(1).setMaxValues(1))];
  const action=new StringSelectMenuBuilder().setCustomId('mcrp_action').setPlaceholder(isLeader?'Choose action: A1 / F1 / CM1':'Choose action: A2 / F2 / T1').addOptions(isLeader?[{label:'Appointed (A1)',value:'A1'},{label:'Fired (F1)',value:'F1'},{label:'Complete Term (CM1)',value:'CM1'}]:[{label:'Appointed (A2)',value:'A2'},{label:'Fired (F2)',value:'F2'},{label:'Transfer (T1)',value:'T1'}]);
  rows.push(new ActionRowBuilder().addComponents(action));
  if(!isLeader) rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('mcrp_org2').setPlaceholder('To Organization (required for T1)').setMinValues(1).setMaxValues(1)));
  rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mcrp_text').setLabel('Text / Reason (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)));
  rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mcrp_desc').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500)));
  // Discord modals cannot contain select menus; build a modal only for text fields and collect selections from the preceding interaction state.
  return m;
}

async function setAfk(guild,user,reason,i){
  if(!BUNNY_ID || user.id!==BUNNY_ID) return i.reply({content:'❌ Only Bunny can activate AFK.',ephemeral:true});
  const d=guildData(guild.id); d.afk={reason,userId:user.id,at:Date.now()}; save(); await i.reply({content:`💤 **Bunny is now AFK.**\nReason: ${reason}`,ephemeral:true}); await log(guild,'AFK enabled',`By ${user.tag}: ${reason}`);
}
async function lock(guild,unlock=false){const d=guildData(guild.id); if(!d.lockRoleId) return false; const role=guild.roles.cache.get(d.lockRoleId); if(!role) return false;
  for(const ch of guild.channels.cache.values()){if(!ch.isTextBased() || !ch.permissionOverwrites) continue; try{const ow=ch.permissionOverwrites.cache.get(role.id); if(!unlock){if(ow && d.lockOverwrites[ch.id]===undefined) d.lockOverwrites[ch.id]=ow.allow.has(PermissionFlagsBits.SendMessages)?'allow':ow.deny.has(PermissionFlagsBits.SendMessages)?'deny':'none'; await ch.permissionOverwrites.edit(role.id,{SendMessages:false});}else{const old=d.lockOverwrites[ch.id]; if(old==='allow') await ch.permissionOverwrites.edit(role.id,{SendMessages:true}); else if(old==='deny') await ch.permissionOverwrites.edit(role.id,{SendMessages:false}); else await ch.permissionOverwrites.delete(role.id).catch(()=>{});}}catch{}}
  if(unlock) d.lockOverwrites={}; save(); return true;
}

const formState = new Map();

function formStateKey(i, type) { return `${i.guild.id}:${i.user.id}:${type}`; }
function formSelectionPanel(type, state = {}) {
  const leader = type === 'leader';
  const rows = [
    new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`mcrp_form_user:${type}`).setPlaceholder('Select User').setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`mcrp_form_org:${type}`).setPlaceholder('Select Organization').setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`mcrp_form_action:${type}`).setPlaceholder(leader ? 'Select Action: A1 / F1 / CM1' : 'Select Action: A2 / F2 / T1').addOptions(
      leader ? [
        {label:'Appointed (A1)',value:'A1'},
        {label:'Fired (F1)',value:'F1'},
        {label:'Complete Term (CM1)',value:'CM1'}
      ] : [
        {label:'Appointed (A2)',value:'A2'},
        {label:'Fired (F2)',value:'F2'},
        {label:'Transfer (T1)',value:'T1'}
      ])),
  ];
  if (!leader && state.action === 'T1') rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`mcrp_form_org2:${type}`).setPlaceholder('Select To Organization').setMinValues(1).setMaxValues(1)));
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mcrp_form_continue:${type}`).setLabel('Continue').setStyle(ButtonStyle.Success)));
  return {content:`**${leader ? 'MCRP LEADERS' : 'MCRP CURATORS'}**\n\nFill the information below. Make sure you fill it correctly.\n\nUser: ${state.userId ? `<@${state.userId}>` : 'Not selected'}\nOrganization: ${state.orgId ? `<@&${state.orgId}>` : 'Not selected'}\nAction: ${state.action || 'Not selected'}${!leader && state.action === 'T1' ? `\nTo Organization: ${state.org2Id ? `<@&${state.org2Id}>` : 'Not selected'}` : ''}`,components:rows};
}

client.on('interactionCreate', async i=>{
  try {
    if (i.isChatInputCommand()) {
      const c=client.commands.get(i.commandName); if(c) return await c.execute(i);
      return;
    }
    if (!i.guild) return;
    const d=guildData(i.guild.id);

    if(i.isButton() && ['mcrp_setup_leader','mcrp_setup_curator','mcrp_setup_edit','mcrp_setup_send','mcrp_back_setup'].includes(i.customId)){
      if(!admin(i)) return i.reply({content:'❌ Administrator permission required.',ephemeral:true});
      if(i.customId==='mcrp_setup_leader'||i.customId==='mcrp_setup_curator'){
        const channels=i.guild.channels.cache.filter(c=>c.type===ChannelType.GuildText).first(25);
        const menu=new StringSelectMenuBuilder().setCustomId(i.customId==='mcrp_setup_leader'?'mcrp_pick_leader':'mcrp_pick_curator').setPlaceholder('Select a text channel').addOptions(channels.map(c=>({label:c.name.slice(0,100),value:c.id})));
        return i.reply({content:'Select the announcement channel:',components:[new ActionRowBuilder().addComponents(menu)],ephemeral:true});
      }
      if(i.customId==='mcrp_setup_edit') return i.update(editMenu());
      if(i.customId==='mcrp_back_setup') return i.update(setupPanel());
      if(i.customId==='mcrp_setup_send'){
        if(!d.setup.leaderChannelId||!d.setup.curatorChannelId) return i.reply({content:'❌ Select both Leader and Curator announcement channels first.',ephemeral:true});
        const msg=await i.channel.send(publicPanel()); d.setup.publicPanelMessageId=msg.id; save(); await i.reply({content:'✅ MCRP public panel published.',ephemeral:true}); return log(i.guild,'MCRP public panel sent',`Channel ${i.channel}`);
      }
    }

    if(i.isStringSelectMenu() && ['mcrp_pick_leader','mcrp_pick_curator'].includes(i.customId)){
      if(!admin(i)) return i.reply({content:'❌ Administrator permission required.',ephemeral:true});
      if(i.customId==='mcrp_pick_leader') d.setup.leaderChannelId=i.values[0]; else d.setup.curatorChannelId=i.values[0];
      save(); return i.update({content:`✅ Channel selected: <#${i.values[0]}>`,components:[]});
    }
    if(i.isStringSelectMenu() && i.customId==='mcrp_template'){
      if(!admin(i)) return i.reply({content:'❌ Administrator permission required.',ephemeral:true});
      const key=i.values[0]; const modal=new ModalBuilder().setCustomId(`mcrp_template_edit:${key}`).setTitle('Edit MCRP Template');
      const input=new TextInputBuilder().setCustomId('template').setLabel('Template').setStyle(TextInputStyle.Paragraph).setValue(d.templates[key]).setRequired(true).setMaxLength(1900);
      modal.addComponents(new ActionRowBuilder().addComponents(input)); return i.showModal(modal);
    }

    if(i.isButton() && (i.customId==='mcrp_leader'||i.customId==='mcrp_curator')){
      const type=i.customId==='mcrp_leader'?'leader':'curator';
      formState.set(formStateKey(i,type),{});
      return i.reply(formSelectionPanel(type,{}));
    }
    if(i.isUserSelectMenu() && i.customId.startsWith('mcrp_form_user:')){
      const type=i.customId.split(':')[1], key=formStateKey(i,type), state=formState.get(key)||{}; state.userId=i.values[0]; formState.set(key,state);
      return i.update(formSelectionPanel(type,state));
    }
    if(i.isRoleSelectMenu() && i.customId.startsWith('mcrp_form_org:')){
      const type=i.customId.split(':')[1], key=formStateKey(i,type), state=formState.get(key)||{}; state.orgId=i.values[0]; formState.set(key,state);
      return i.update(formSelectionPanel(type,state));
    }
    if(i.isStringSelectMenu() && i.customId.startsWith('mcrp_form_action:')){
      const type=i.customId.split(':')[1], key=formStateKey(i,type), state=formState.get(key)||{}; state.action=i.values[0]; if(type==='curator'&&state.action!=='T1') delete state.org2Id; formState.set(key,state);
      return i.update(formSelectionPanel(type,state));
    }
    if(i.isRoleSelectMenu() && i.customId.startsWith('mcrp_form_org2:')){
      const type=i.customId.split(':')[1], key=formStateKey(i,type), state=formState.get(key)||{}; state.org2Id=i.values[0]; formState.set(key,state);
      return i.update(formSelectionPanel(type,state));
    }
    if(i.isButton() && i.customId.startsWith('mcrp_form_continue:')){
      const type=i.customId.split(':')[1], key=formStateKey(i,type), state=formState.get(key)||{};
      if(!state.userId||!state.orgId||!state.action) return i.reply({content:'❌ Please select User, Organization, and Action first.',ephemeral:true});
      if(type==='curator'&&state.action==='T1'&&!state.org2Id) return i.reply({content:'❌ Select To Organization for T1 Transfer.',ephemeral:true});
      const modal=new ModalBuilder().setCustomId(`mcrp_action:${type}:${state.userId}:${state.orgId}:${state.action}:${state.org2Id||''}`).setTitle(type==='leader'?'MCRP LEADERS':'MCRP CURATORS');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Text / Reason (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500))
      );
      return i.showModal(modal);
    }
    if(i.isModalSubmit() && i.customId.startsWith('mcrp_template_edit:')){
      if(!admin(i)) return i.reply({content:'❌ Administrator permission required.',ephemeral:true});
      const key=i.customId.split(':')[1]; d.templates[key]=i.fields.getTextInputValue('template'); save(); await i.reply({content:'✅ Template saved.',ephemeral:true}); return log(i.guild,'Template edited',`${key} by ${i.user.tag}`);
    }
    if(i.isModalSubmit() && i.customId.startsWith('mcrp_action:')){
      const parts=i.customId.split(':'); const type=parts[1], uid=parts[2], oid=parts[3], action=parts[4], oid2=parts[5]||'';
      const text=i.fields.getTextInputValue('text').trim(), description=i.fields.getTextInputValue('description').trim();
      if(!text&&!description) return i.reply({content:'❌ Text/Reason or Description is required. Please provide at least one.',ephemeral:true});
      const member=await i.guild.members.fetch(uid).catch(()=>null), org=i.guild.roles.cache.get(oid), org2=oid2?i.guild.roles.cache.get(oid2):null;
      if(!member||!org) return i.reply({content:'❌ Selected user or organization is no longer available.',ephemeral:true});
      if(type==='curator'&&action==='T1'&&!org2) return i.reply({content:'❌ To Organization is required for T1 transfer.',ephemeral:true});
      const key=type==='leader'?({A1:'leaderAppointed',F1:'leaderFired',CM1:'leaderComplete'}[action]):({A2:'curatorAppointed',F2:'curatorFired',T1:'curatorTransfer'}[action]);
      if(!key) return i.reply({content:'❌ Invalid action.',ephemeral:true});
      const vars={user:member.toString(),organization:roleLabel(org),organization2:roleLabel(org2),text,description};
      const channelId=type==='leader'?d.setup.leaderChannelId:d.setup.curatorChannelId, ch=i.guild.channels.cache.get(channelId);
      if(!ch?.isTextBased()) return i.reply({content:'❌ Announcement channel is not configured.',ephemeral:true});
      await ch.send(render(d.templates[key],vars)); formState.delete(formStateKey(i,type)); await i.reply({content:'✅ Action processed and announcement sent.',ephemeral:true}); return log(i.guild,`${type} action`,`${action} | ${member.user.tag} | ${org.name}${org2?' → '+org2.name:''} | By ${i.user.tag}`);
    }
  } catch(e) {
    console.error(e); if(i.isRepliable()&&!i.replied&&!i.deferred) await i.reply({content:'❌ Something went wrong. Check the bot console/log channel.',ephemeral:true}).catch(()=>{}); if(i.guild) await log(i.guild,'Error',e.message);
  }
});

client.on('messageCreate', async msg=>{
  if(msg.author.bot || !msg.guild) return;
  const d=guildData(msg.guild.id);
  // AFK clear when Bunny sends a normal message
  if(BUNNY_ID && msg.author.id===BUNNY_ID && d.afk){d.afk=null; save(); await log(msg.guild,'AFK disabled','Bunny sent a normal message.');}
  // Bunny tag notification
  if(BUNNY_ID && d.afk && msg.mentions.users.has(BUNNY_ID)){
    await msg.reply('Bunny is AFK. Please do not tag Bunny again.').catch(()=>{});
    const bunny=await client.users.fetch(BUNNY_ID).catch(()=>null); if(bunny) await bunny.send(`🔔 You were tagged by **${msg.author.tag}** in **#${msg.channel.name}** while AFK.\nReason: ${d.afk.reason}`).catch(()=>{});
  }
  // Welcome once per member for hello/hi/hey
  if(/^(hi|hello|hey)[!., ]*$/i.test(msg.content.trim()) && !d.welcomed.includes(msg.author.id)){d.welcomed.push(msg.author.id); save(); await msg.channel.send('**WELCOME TO MOON CITY RP**').catch(()=>{});}
  // server template auto-delete (common invite/template links)
  if(/discord\.new\/|discord\.com\/templates\//i.test(msg.content)){await msg.delete().catch(()=>{}); await msg.author.send('Your server template message was removed from Moon City RP.').catch(()=>{}); await log(msg.guild,'Server template removed',`By ${msg.author.tag} in #${msg.channel.name}`);}
  if(msg.content==='!MCRP-MCRP'||msg.content==='!MCRP-EDIT'||msg.content==='!MCRP-DELETE'||msg.content==='!MCRP DELETE'||msg.content==='!MCRP-LOCK'||msg.content==='!MCRP-UNLOCK'||msg.content==='!lock-role'||msg.content==='!unlock-role'||msg.content.toUpperCase().startsWith('!AFK')){
    if(msg.content==='!MCRP-MCRP'||msg.content==='!MCRP-EDIT'){if(!admin(msg)) return msg.reply('❌ Administrator permission required.'); const old=d.setup.panelChannelId===msg.channel.id&&d.setup.panelMessageId?msg.channel.messages.cache.get(d.setup.panelMessageId):null; if(old){await old.edit(setupPanel()).catch(()=>{}); return msg.reply('✅ Existing MCRP setup panel updated.');} const m=await msg.channel.send(setupPanel()); d.setup.panelChannelId=msg.channel.id; d.setup.panelMessageId=m.id; save(); return log(msg.guild,'MCRP setup panel opened',`By ${msg.author.tag}`);}
    if(msg.content==='!MCRP-DELETE'||msg.content==='!MCRP DELETE'){if(!admin(msg)) return msg.reply('❌ Administrator permission required.'); db.guilds[msg.guild.id]=undefined; delete db.guilds[msg.guild.id]; save(); return msg.reply('🗑️ MCRP setup/config deleted.');}
    if(msg.content==='!MCRP-LOCK'||msg.content==='!lock-role'){if(!admin(msg)) return msg.reply('❌ Administrator permission required.'); const ok=await lock(msg.guild,false); return msg.reply(ok?'🔒 Selected MCRP role locked.':'❌ Set a lock role first with `/mcrp-lock @role`.');}
    if(msg.content==='!MCRP-UNLOCK'||msg.content==='!unlock-role'){if(!admin(msg)) return msg.reply('❌ Administrator permission required.'); const ok=await lock(msg.guild,true); return msg.reply(ok?'🔓 Selected MCRP role restored/unlocked.':'❌ No lock role configured.');}
    if(msg.content.toUpperCase().startsWith('!AFK')){if(BUNNY_ID&&msg.author.id!==BUNNY_ID) return msg.reply('❌ Only Bunny can activate AFK.'); const reason=msg.content.slice(4).trim()||'No reason provided'; d.afk={reason,userId:msg.author.id,at:Date.now()}; save(); await msg.reply(`💤 **Bunny is now AFK.**\nReason: ${reason}`); return log(msg.guild,'AFK enabled',`By ${msg.author.tag}: ${reason}`);}
  }
});

client.on('guildMemberAdd', async member=>{const d=guildData(member.guild.id); if(d.autoTag.enabled&&d.autoTag.channelId){const ch=member.guild.channels.cache.get(d.autoTag.channelId); if(ch?.isTextBased()){const m=await ch.send(`${member}`).catch(()=>null); if(m) setTimeout(()=>m.delete().catch(()=>{}),5000); await log(member.guild,'Auto-tag member',`${member.user.tag} → #${ch.name}`);}}});
client.once('ready',async()=>{console.log(`MCRP BOT | DEVELOPER BUNNY99661 | ${client.user.tag}`); client.user.setPresence({activities:[{name:'MCRP | DEVELOPER BUNNY99661'}],status:'online'}); const rest=new REST({version:'10'}).setToken(TOKEN); const body=[...client.commands.values()].map(c=>c.data.toJSON()); await rest.put(Routes.applicationCommands(CLIENT_ID),{body}); console.log(`Registered ${body.length} MCRP slash commands.`);});

const web=express(); web.get('/health',(req,res)=>res.json({status:'ok',bot:client.isReady(),name:'MCRP BOT',developer:'BUNNY99661'})); web.listen(Number(process.env.PORT||3000),'0.0.0.0');
client.login(TOKEN);
