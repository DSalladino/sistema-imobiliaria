import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const arquivo = path.join(DATA_DIR, 'imobiliaria.db');

if (fs.existsSync(arquivo)) {
  for (const sufixo of ['', '-wal', '-shm']) {
    const f = arquivo + sufixo;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log('Banco removido. Na próxima execução ele será recriado com os dados de exemplo.');
} else {
  console.log('Nenhum banco encontrado em', arquivo);
}
