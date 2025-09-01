import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason
} from '@whiskeysockets/baileys';
import { askGpt4, transcribeAudio } from './openai.js';
import { extractTextFromFile } from './fileProcessor.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as chrono from 'chrono-node';   // ✅ import completo
import { addReminder, restoreReminders, listReminders, cancelReminder } from './reminderManager.js';

const execAsync = promisify(exec);

const conversationHistories = new Map();
const CONTEXT_WINDOW_MESSAGES = 15;
const MAX_FILE_SIZE_MB = 15;

const mediaDir = path.join('./media');
await fs.mkdir(mediaDir, { recursive: true });

// -------------------------------------------
// 🔎 Expressões que disparam lembrete
// -------------------------------------------
const reminderTriggers = [
  "me lembre",
  "não me deixe esquecer",
  "nao me deixe esquecer",
  "me avise",
  "me recorde",
  "me faça lembrar",
  "me faca lembrar",
  "me cobre",
  "me alerta",
  "não esqueça de",
  "nao esqueça de"
];

function isReminderRequest(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return reminderTriggers.some(trigger => lower.includes(trigger));
}

// -------------------------------------------

async function convertToMp3(inputPath) {
  const outputPath = inputPath.replace(/\.\w+$/, '.mp3');
  try {
    await execAsync(`ffmpeg -y -i "${inputPath}" -ar 44100 -ac 2 -b:a 192k "${outputPath}"`);
    console.log(`🎵 Áudio convertido para MP3: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error('❌ Erro ao converter áudio:', err.message);
    return inputPath;
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({ version, auth: state });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('📱 Escaneie o QR code abaixo com seu WhatsApp:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('⚠️ Conexão encerrada. Reconectar?', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Conectado ao WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const sender = msg.key.remoteJid;
      const messageType = Object.keys(msg.message)[0];
      let text;
      let isFileAnalysis = false;
      let imageBuffer = null;

      try {
        // 🎧 Áudio
        if (messageType === 'audioMessage') {
          const audioMsg = msg.message.audioMessage;
          console.log(`[${sender}] 🎤 Recebeu um áudio (${audioMsg.mimetype}).`);

          const audioBuffer = await downloadMediaMessage(msg, 'buffer', {});

          let ext = '.ogg';
          if (audioMsg.mimetype.includes('mp4')) ext = '.mp4';
          else if (audioMsg.mimetype.includes('mpeg') || audioMsg.mimetype.includes('mp3')) ext = '.mp3';
          else if (audioMsg.mimetype.includes('wav')) ext = '.wav';
          else if (audioMsg.mimetype.includes('webm')) ext = '.webm';
          else if (audioMsg.mimetype.includes('oga')) ext = '.oga';

          let audioPath = path.join(mediaDir, `${Date.now()}${ext}`);
          await fs.writeFile(audioPath, audioBuffer);

          if (!['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.webm', '.flac'].includes(ext)) {
            audioPath = await convertToMp3(audioPath);
          }

          text = await transcribeAudio(audioPath);
          console.log(`[${sender}] Texto transcrito: "${text}"`);
        }
        // 📄 Documento
        else if (messageType === 'documentMessage') {
          const docMsg = msg.message.documentMessage;
          console.log(`[${sender}] 📄 Recebeu um documento: ${docMsg.fileName}`);
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          const sizeMb = buffer.length / (1024 * 1024);
          if (sizeMb > MAX_FILE_SIZE_MB) {
            await sock.sendMessage(sender, { text: `⚠️ O arquivo é muito grande (${sizeMb.toFixed(2)} MB). Limite: ${MAX_FILE_SIZE_MB} MB.` });
            continue;
          }
          const filePath = path.join(mediaDir, docMsg.fileName);
          await fs.writeFile(filePath, buffer);
          const extractedText = await extractTextFromFile(filePath, docMsg.mimetype);
          text = `O usuário enviou o arquivo "${docMsg.fileName}". Conteúdo:\n\n${extractedText}\n\nResuma os pontos principais.`;
          isFileAnalysis = true;
        }
        // 📸 Imagem
        else if (messageType === 'imageMessage') {
          console.log(`[${sender}] 📸 Recebeu uma imagem.`);
          imageBuffer = await downloadMediaMessage(msg, 'buffer', {});
          text = msg.message.imageMessage.caption || 'O que você vê nesta imagem? Descreva-a para mim.';
        }
        // 💬 Texto
        else {
          text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        }

        // ---------------------------
        // 🕒 SISTEMA DE LEMBRETES
        // ---------------------------

        if (isReminderRequest(text)) {
          let parsedDate;
          const lower = text.toLowerCase();

          // 1) Detecta "em X minutos" ou "daqui a X minutos"
          let match = lower.match(/(?:em|daqui a)\s+(\d+)\s*min(uto|utos)?/);
          if (match) {
            const minutes = parseInt(match[1], 10);
            parsedDate = new Date(Date.now() + minutes * 60 * 1000);
          }

          // 2) Detecta "em X horas" ou "daqui a X horas"
          if (!parsedDate) {
            match = lower.match(/(?:em|daqui a)\s+(\d+)\s*h(ora|oras)?/);
            if (match) {
              const hours = parseInt(match[1], 10);
              parsedDate = new Date(Date.now() + hours * 60 * 60 * 1000);
            }
          }

          // 3) Se não caiu nos casos manuais, usa chrono
          if (!parsedDate) {
            const results = chrono.parse(text, new Date(), { forwardDate: true });
            if (!results || results.length === 0) {
              await sock.sendMessage(sender, { text: '🤔 Não consegui entender a data/hora do lembrete. Exemplo: "Me avise amanhã às 14h de ligar para João".' });
              continue;
            }

            parsedDate = results[0].start.date();

            // Força HOJE se não mencionou dia/mês/ano
            const hasExplicitDay =
              results[0].start.isCertain('day') ||
              results[0].start.isCertain('month') ||
              results[0].start.isCertain('year');

            if (!hasExplicitDay) {
              const now = new Date();
              parsedDate.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
            }
          }

          const reminderMessage = text.replace(/(me lembre|não me deixe esquecer|nao me deixe esquecer|me avise|me recorde|me faça lembrar|me faca lembrar|me cobre|me alerta|não esqueça de|nao esqueça de).*?(de|que)?\s*/i, '').trim();

          if (!reminderMessage) {
            await sock.sendMessage(sender, { text: '⚠️ Você precisa me dizer o que lembrar. Exemplo: "Me avise amanhã às 10h de pagar a conta".' });
            continue;
          }

          const newReminder = await addReminder(sock, sender, parsedDate, reminderMessage);

          // confirmação humanizada pela IA
          await sock.sendMessage(sender, { text: newReminder.confirmation });
          continue;
        }

        if (text?.toLowerCase().includes('meus lembretes')) {
          const reply = await listReminders(sender);
          await sock.sendMessage(sender, { text: reply });
          continue;
        }

        if (text?.toLowerCase().includes('cancelar lembrete')) {
          const reply = await cancelReminder(sender, text);
          await sock.sendMessage(sender, { text: reply });
          continue;
        }

        // ---------------------------
        // 🚀 Fluxo normal para GPT
        // ---------------------------

        if (text) {
          if (!conversationHistories.has(sender)) conversationHistories.set(sender, []);
          const userHistory = conversationHistories.get(sender);

          if (isFileAnalysis) {
            userHistory.push({ role: 'user', content: `[Enviou o arquivo "${msg.message.documentMessage.fileName}" para análise]` });
          } else {
            userHistory.push({ role: 'user', content: text });
          }

          const payloadForGpt = isFileAnalysis ? [{ role: 'user', content: text }] : userHistory;

          console.log(`[${sender}] 🚀 Enviando para o GPT...`);
          const reply = await askGpt4(payloadForGpt, imageBuffer);

          userHistory.push({ role: 'assistant', content: reply });
          while (userHistory.length > CONTEXT_WINDOW_MESSAGES) userHistory.shift();

          await sock.sendMessage(sender, { text: reply });
        }
      } catch (err) {
        console.error(`[${sender}] ❌ Erro ao processar mensagem:`, err.message);
        await sock.sendMessage(sender, { text: '⚠️ Ocorreu um erro ao processar sua mensagem. Tente novamente mais tarde.' });
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  await restoreReminders(sock);
}

startBot();