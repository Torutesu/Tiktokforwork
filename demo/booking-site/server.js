import { createServer } from 'node:http';
import { page } from './src/render.js';

const port = Number(process.env.PORT || process.argv[process.argv.indexOf('--port') + 1] || 3000);
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(port, '0.0.0.0', () => console.log(`booking site on http://0.0.0.0:${port}`));
