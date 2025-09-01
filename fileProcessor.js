import fs from 'fs/promises';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

export async function extractTextFromFile(filePath, mimeType) {
  try {
    console.log(`📄 Processando arquivo: ${filePath} (Tipo: ${mimeType})`);

    switch (mimeType) {
      case 'application/pdf': {
        const dataBuffer = await fs.readFile(filePath);
        const data = await pdf(dataBuffer);
        return data.text.trim() || '[PDF vazio ou ilegível]';
      }

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value.trim() || '[Documento Word vazio ou ilegível]';
      }

      case 'text/plain': {
        return (await fs.readFile(filePath, { encoding: 'utf-8' })).trim();
      }

      case 'application/json': {
        const jsonContent = await fs.readFile(filePath, { encoding: 'utf-8' });
        try {
          return JSON.stringify(JSON.parse(jsonContent), null, 2);
        } catch {
          return '[Arquivo JSON inválido]';
        }
      }

      case 'text/csv': {
        const csvContent = await fs.readFile(filePath, { encoding: 'utf-8' });
        return csvContent.slice(0, 2000) + (csvContent.length > 2000 ? '\n...[Conteúdo truncado]' : '');
      }

      case 'text/markdown': {
        return await fs.readFile(filePath, { encoding: 'utf-8' });
      }

      default:
        console.warn(`[Aviso] Tipo de arquivo não suportado: ${mimeType}`);
        return `[Arquivo do tipo "${mimeType}" não é suportado para leitura.]`;
    }
  } catch (error) {
    console.error('❌ Erro ao extrair texto do arquivo:', error.message);
    return '[Ocorreu um erro ao tentar ler o conteúdo do arquivo.]';
  } finally {
    try {
      // só exclui arquivos da pasta ./media
      if (filePath.startsWith(path.resolve('./media'))) {
        await fs.unlink(filePath);
        console.log(`🗑️ Arquivo temporário excluído: ${filePath}`);
      }
    } catch {}
  }
}