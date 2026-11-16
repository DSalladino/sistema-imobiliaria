import path from 'node:path';

// Cria uma base de demonstração separada da produção.
process.env.DATA_DIR = process.env.DEMO_DATA_DIR || path.join(process.cwd(), 'data-demo');

const { carregarDemo } = await import('./manutencao.js');
carregarDemo();
console.log('Base de demonstração pronta em', process.env.DATA_DIR);
