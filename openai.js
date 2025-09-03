import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';

dotenv.config();

let openAIConfig;
try {
  const configPath = path.join('./config', 'openai.config.json');
  openAIConfig = JSON.parse(fs.readFileSync(configPath, { encoding: 'utf-8' }));
} catch (error) {
  console.error('❌ Erro fatal: Não foi possível carregar "config/openai.config.json".');
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ Erro fatal: Variável OPENAI_API_KEY não definida no .env.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function askGpt5(messageHistory, imageBuffer = null) {
  try {
    const messagesPayload = [
      { role: 'system', content: openAIConfig.systemPrompt },
      ...messageHistory,
    ];

    if (imageBuffer) {
      console.log('🖼️ Anexando imagem à requisição...');
      const base64Image = imageBuffer.toString('base64');
      const lastUserMessage = messagesPayload[messagesPayload.length - 1];
      lastUserMessage.content = [
        { type: 'text', text: lastUserMessage.content },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
      ];
    }

    const completion = await openai.chat.completions.create({
      model: openAIConfig.model || 'gpt-5-mini',
      temperature: openAIConfig.temperature ?? 1,
      max_completion_tokens: openAIConfig.max_completion_tokens ?? 1024,
      messages: messagesPayload,
    });

    return completion.choices[0]?.message?.content || 'Não consegui gerar uma resposta.';
  } catch (err) {
    console.error('❌ Erro na API OpenAI:', err.message);
    return '⚠️ Houve um problema ao gerar a resposta.';
  }
}

export async function transcribeAudio(audioPath) {
  try {
    console.log(`🎤 Transcrevendo áudio: ${audioPath}`);
    const audioStream = fs.createReadStream(audioPath);

    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-1',
    });

    console.log('✅ Transcrição concluída.');
    return transcription.text || '[Não foi possível transcrever o áudio.]';
  } catch (err) {
    console.error('❌ Erro ao transcrever áudio:', err.message);
    return '[Erro durante a transcrição do áudio.]';
  } finally {
    try {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    } catch {}
  }
}