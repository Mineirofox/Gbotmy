// reminderParser.js
import * as chrono from 'chrono-node';

// ---------- Utilitários ----------
function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function normalizeBase(str) {
  return stripAccents(str).replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
}

// ---------- Gatilhos ----------
const reminderTriggers = [
  "me lembre",
  "nao me deixe esquecer",
  "me avise",
  "me recorde",
  "me faca lembrar",
  "me cobre",
  "me alerta",
  "nao esqueça de"
].map(stripAccents);

const months = {
  "janeiro": 0, "fevereiro": 1,
  "marco": 2, "março": 2,
  "abril": 3, "maio": 4,
  "junho": 5, "julho": 6,
  "agosto": 7, "setembro": 8,
  "outubro": 9, "novembro": 10,
  "dezembro": 11
};

// ---------- Detecta intenção ----------
export function isReminderRequest(text) {
  if (!text) return false;
  const normalized = stripAccents(text);
  return reminderTriggers.some(trigger => normalized.includes(trigger));
}

// ---------- Normalização ----------
function normalizeTimeExpressions(originalText) {
  let updated = normalizeBase(originalText);

  // meio dia / meia noite
  updated = updated.replace(/\bmeio dia\b/gi, "12:00");
  updated = updated.replace(/\bmeia noite\b/gi, "00:00");

  // "9 e 22" → "09:22"
  updated = updated.replace(
    /\b(\d{1,2})\s*e\s*(\d{1,2})\b/g,
    (_, h, m) => `${parseInt(h).toString().padStart(2,"0")}:${parseInt(m).toString().padStart(2,"0")}`
  );

  // números por extenso
  const extenso = {
    "zero":0,"um":1,"uma":1,"dois":2,"duas":2,"tres":3,"três":3,
    "quatro":4,"cinco":5,"seis":6,"sete":7,"oito":8,"nove":9,
    "dez":10,"onze":11,"doze":12,
    "treze":13,"catorze":14,"quatorze":14,"quinze":15,
    "dezesseis":16,"dezessete":17,"dezoito":18,"dezenove":19,
    "vinte":20,"vinte e um":21,"vinte e uma":21,"vinte e dois":22,
    "vinte e tres":23,"vinte e três":23,
    "vinte e quatro":24,"vinte e cinco":25,"vinte e seis":26,
    "vinte e sete":27,"vinte e oito":28,"vinte e nove":29,
    "trinta":30,"trinta e um":31,"trinta e dois":32,
    "trinta e tres":33,"trinta e três":33,
    "quarenta":40,"quarenta e um":41,"quarenta e dois":42,"quarenta e tres":43,"quarenta e três":43,
    "quarenta e quatro":44,"quarenta e cinco":45,"quarenta e seis":46,"quarenta e sete":47,
    "quarenta e oito":48,"quarenta e nove":49,
    "cinquenta":50,"cinquenta e um":51,"cinquenta e dois":52,"cinquenta e tres":53,"cinquenta e três":53,
    "cinquenta e quatro":54,"cinquenta e cinco":55,"cinquenta e seis":56,"cinquenta e sete":57,
    "cinquenta e oito":58,"cinquenta e nove":59
  };

  // horas + minutos por extenso (ex: três e quarenta e oito → 03:48)
  updated = updated.replace(
    new RegExp(`\\b(${Object.keys(extenso).join("|")}) e (${Object.keys(extenso).join("|")}(?: e ${Object.keys(extenso).join("|")})*)\\b`, "gi"),
    (_, hWord, mWord) => {
      const hour = extenso[hWord.toLowerCase()] ?? 0;
      const minute = extenso[mWord.toLowerCase()] ?? 0;
      return `${hour.toString().padStart(2,"0")}:${minute.toString().padStart(2,"0")}`;
    }
  );

  // HHhMM → HH:MM
  updated = updated.replace(/\b(\d{1,2})h(\d{1,2})\b/g,
    (_, h, m) => `${h}:${m.padStart(2,"0")}`);

  // HHh → HH:00
  updated = updated.replace(/\b(\d{1,2})h\b/gi, (_, h) => `${h}:00`);

  // HH horas → HH:00
  updated = updated.replace(/\b(\d{1,2})\s+horas?\b/gi, (_, h) => `${h}:00`);

  // “X e meia”
  updated = updated.replace(/\b(\d{1,2}) e meia\b/gi, (_, h) => `${h}:30`);

  // "X horas da manhã/tarde/noite"
  updated = updated.replace(
    /\b(\d{1,2})\s*horas?\s+da\s+(manha|tarde|noite)\b/gi,
    (_, h, periodo) => {
      let hour = parseInt(h, 10);
      if (periodo === "tarde" && hour < 12) hour += 12;
      if (periodo === "noite" && hour < 12) hour += 12;
      if (periodo === "manha" && hour === 12) hour = 0;
      return `${hour.toString().padStart(2,"0")}:00`;
    }
  );

  return updated;
}

// ---------- Parser principal ----------
export function parseReminderRequest(text) {
  if (!text) return null;
  const normalized = normalizeTimeExpressions(text);
  let parsedDate;

  // --- relativo em minutos
  let match = normalized.match(/(?:em|daqui a)\s+(\d+)\s*min/i);
  if (match) parsedDate = new Date(Date.now() + parseInt(match[1],10)*60*1000);

  // --- relativo em horas
  if (!parsedDate) {
    match = normalized.match(/(?:em|daqui a)\s+(\d+)\s*h/i);
    if (match) parsedDate = new Date(Date.now() + parseInt(match[1],10)*60*60*1000);
  }

  // --- data completa manual
  if (!parsedDate) {
    const manualRegex = /dia\s+(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(\d{2,4}))?/i;
    const matchDate = normalized.match(manualRegex);
    if (matchDate) {
      const day = parseInt(matchDate[1],10);
      const monthName = matchDate[2];
      const year = matchDate[3] ? parseInt(matchDate[3],10) : new Date().getFullYear();
      const monthIndex = months[monthName];
      if (monthIndex !== undefined) {
        let hour=0, minute=0;
        const hourRegex = /\b(?:as|às)\s+(\d{1,2})(?::(\d{2}))?\b/i;
        const matchHour = normalized.match(hourRegex);
        if (matchHour) {
          hour = parseInt(matchHour[1],10);
          minute = matchHour[2] ? parseInt(matchHour[2],10) : 0;
        }
        parsedDate = new Date(year, monthIndex, day, hour, minute);
      }
    }
  }

  // --- datas numéricas tipo 05/09/2025 às 11:32
  if (!parsedDate) {
    const numRegex = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?(?:\s+(?:as|às)\s+(\d{1,2})(?::(\d{2}))?)?/i;
    const n = normalized.match(numRegex);
    if (n) {
      const d = parseInt(n[1],10), m = parseInt(n[2],10)-1;
      const y = n[3] ? parseInt(n[3],10) : new Date().getFullYear();
      const h = n[4] ? parseInt(n[4],10) : 0;
      const min = n[5] ? parseInt(n[5],10) : 0;
      parsedDate = new Date(y,m,d,h,min);
    }
  }

  // --- fallback chrono
  if (!parsedDate) {
    const results = chrono.parse(normalized, new Date(), { forwardDate:true });
    if (results && results.length > 0) {
      parsedDate = results[0].start.date();
    }
  }

  // --- Força "amanha"
  if (/amanha/.test(normalized)) {
    const now = new Date();
    let base = parsedDate;
    parsedDate = new Date(now);
    parsedDate.setDate(now.getDate() + 1);

    if (base && !isNaN(base.getTime())) {
      parsedDate.setHours(base.getHours());
      parsedDate.setMinutes(base.getMinutes());
    }
  }

  if (!parsedDate) {
    return { error:"🤔 Não consegui entender a data/hora. Ex: 'amanhã às 14h' ou '05/09/2025 às 11h'." };
  }

  // ---------- mensagem ----------
  let reminderMessage = text;

  // remove gatilhos
  reminderMessage = reminderMessage.replace(
    /(me lembre|me avise|não me deixe esquecer|nao me deixe esquecer|me recorde|me faça lembrar|me faca lembrar|me cobre|me alerta|não esqueça de|nao esqueça de)/i,
    ""
  );

  // remove palavras de tempo
  reminderMessage = reminderMessage.replace(/\b(amanhã|hoje|depois de amanhã)[,\.]?/gi, "");

  // remove expressões de horário numéricas e textuais
  reminderMessage = reminderMessage.replace(
    /(,?\s*às?\s*[\d:]+h?(\d+)?(\s*h(oras?)?)?(\s*(da manhã|da tarde|da noite|meio[- ]dia|meia[- ]noite))?)/gi,
    ""
  );

  reminderMessage = reminderMessage.trim().replace(/^[,\.]\s*/, "");
  reminderMessage = reminderMessage.replace(/^de\s+/i, "").trim();

  if (!reminderMessage) {
    return { error:"⚠️ Você precisa dizer o que lembrar. Ex: 'Me avise amanhã às 10h de pagar a conta'." };
  }

  return { date: parsedDate, message: reminderMessage };
}