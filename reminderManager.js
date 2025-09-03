import fs from 'fs/promises';
import path from 'path';
import schedule from 'node-schedule';
import { askGpt4 } from './openai.js'; // IA da OpenAI

const dataDir = path.join('./data');
const remindersFile = path.join(dataDir, 'reminders.json');

await fs.mkdir(dataDir, { recursive: true });

async function loadReminders() {
  try {
    const data = await fs.readFile(remindersFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveReminders(reminders) {
  await fs.writeFile(remindersFile, JSON.stringify(reminders, null, 2), 'utf-8');
}

function scheduleJob(sock, reminder) {
  const when = new Date(reminder.date);

  if (!(when instanceof Date) || isNaN(when.getTime())) {
    console.error('❌ Data inválida, não foi possível agendar:', reminder.date);
    return;
  }

  console.log(`📌 [Agendado] (${reminder.id}) "${reminder.message}" → ${when.toLocaleString('pt-BR')}`);

  schedule.scheduleJob(reminder.id, when, async () => {
    console.log(`🚀 [Disparado] "${reminder.message}" - ${new Date().toLocaleString('pt-BR')}`);
    try {
      // IA gera a mensagem humanizada
      const gptPrompt = [
        {
          role: 'system',
          content: 'Você é um assistente de WhatsApp simpático e amigável. Sempre responda de forma natural, breve e acolhedora.'
        },
        {
          role: 'user',
          content: `Agora é hora de lembrar o usuário sobre: "${reminder.message}". 
                    Crie uma mensagem curta, amigável e humanizada para enviar.`
        }
      ];

      const aiReply = await askGpt4(gptPrompt);

      await sock.sendMessage(reminder.sender, { text: aiReply });
      await removeReminder(reminder.id);
    } catch (err) {
      console.error(`[${reminder.sender}] ❌ Erro ao enviar lembrete:`, err.message);
    }
  });
}

async function removeReminder(id) {
  const reminders = await loadReminders();
  const updated = reminders.filter(r => r.id !== id);
  await saveReminders(updated);

  const job = schedule.scheduledJobs[id];
  if (job) job.cancel();
}

export async function restoreReminders(sock) {
  const reminders = await loadReminders();
  const now = new Date();

  for (const reminder of reminders) {
    const reminderDate = new Date(reminder.date);

    if (isNaN(reminderDate.getTime())) {
      console.error('❌ Data inválida no JSON:', reminder.date);
      continue;
    }

    if (reminderDate > now) {
      scheduleJob(sock, { ...reminder, date: reminderDate });
    } else {
      console.log(`🗑️ Limpando lembrete expirado: "${reminder.message}"`);
      await removeReminder(reminder.id);
    }
  }
}

export async function addReminder(sock, sender, date, message) {
  let reminderDate = new Date(date);

  if (isNaN(reminderDate.getTime())) {
    throw new Error('Data inválida para lembrete.');
  }

  if (reminderDate <= new Date()) {
    reminderDate = new Date(Date.now() + 60 * 1000); // 1 minuto no futuro
    console.log('⚠️ Ajustei a data, estava no passado:', reminderDate.toLocaleString('pt-BR'));
  }

  const newReminder = {
    id: Date.now().toString(),
    sender,
    date: reminderDate.toISOString(),
    message,
  };

  const reminders = await loadReminders();
  reminders.push(newReminder);
  await saveReminders(reminders);

  scheduleJob(sock, { ...newReminder, date: reminderDate });

  // IA gera a confirmação humanizada
  const gptPrompt = [
    {
      role: 'system',
      content: 'Você é um assistente de WhatsApp simpático e amigável.'
    },
    {
      role: 'user',
      content: `Crie uma mensagem curta e acolhedora confirmando que o lembrete foi salvo.
                O lembrete é: "${message}" em ${reminderDate.toLocaleString('pt-BR')}.`
    }
  ];

  const confirmation = await askGpt4(gptPrompt);

  return { ...newReminder, confirmation };
}

export async function listReminders(sender) {
  const reminders = await loadReminders();
  const userReminders = reminders.filter(r => r.sender === sender);

  if (userReminders.length === 0) return '🙌 Você não tem lembretes ativos.';

  let response = '📅 Seus lembretes:\n\n';
  userReminders.forEach((r, i) => {
    response += `${i + 1}. *${r.message}* → ${new Date(r.date).toLocaleString('pt-BR')}\n`;
  });
  return response;
}

export async function cancelReminder(sender, text) {
  const reminders = await loadReminders();
  const userReminders = reminders.filter(r => r.sender === sender);

  if (userReminders.length === 0) {
    return '🙌 Você não tem lembretes ativos.';
  }

  const found = userReminders.find(r =>
    r.message.toLowerCase().includes(text.toLowerCase()) ||
    text.toLowerCase().includes(r.message.toLowerCase())
  );

  if (!found) {
    return '⚠️ Não encontrei nenhum lembrete correspondente ao que você quer cancelar.';
  }

  await removeReminder(found.id);
  return `❌ Lembrete cancelado: *${found.message}*`;
}

// 🔹 NOVA FUNÇÃO: apagar todos os lembretes do usuário
export async function clearAllReminders(sender) {
  const reminders = await loadReminders();
  const userReminders = reminders.filter(r => r.sender === sender);

  if (userReminders.length === 0) {
    return '🙌 Você não tem lembretes para apagar.';
  }

  for (const r of userReminders) {
    await removeReminder(r.id);
  }

  return `🗑️ Todos os seus ${userReminders.length} agendamentos foram apagados.`;
}