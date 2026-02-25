import { defineConfig } from 'vite'
import { resolve, join } from 'path'
import fs from 'fs'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  server: {
    headers: {
      'Cache-Control': 'no-store',
    }
  },
  plugins: [
    {
      name: 'fs-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url.startsWith('/api/folders/create')) {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const id = url.searchParams.get('id');
            const name = url.searchParams.get('name');
            if (id) {
              const dir = resolve(__dirname, 'public', 'projects', id);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                // Create a placeholder readme to ensure folder is visible
                fs.writeFileSync(join(dir, 'info.txt'), `Progetto: ${name}\nInserisci qui le tue immagini.`);
              }
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true, path: dir }));
              return;
            }
          }

          if (req.url.startsWith('/api/folders/list')) {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const id = url.searchParams.get('id');
            if (id) {
              const dir = resolve(__dirname, 'public', 'projects', id);
              if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir)
                  .filter(f => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f))
                  .map(f => `/projects/${id}/${f}`);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ images: files }));
                return;
              }
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Folder not found' }));
            return;
          }

          if (req.url.startsWith('/api/uploads/save') && req.method === 'POST') {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const id = url.searchParams.get('id');
            const fileName = url.searchParams.get('name');

            if (id && fileName) {
              const dir = resolve(__dirname, 'public', 'projects', id);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

              const filePath = join(dir, fileName);
              const chunks = [];
              req.on('data', chunk => chunks.push(chunk));
              req.on('end', () => {
                const buffer = Buffer.concat(chunks);
                fs.writeFileSync(filePath, buffer);
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true, url: `/projects/${id}/${fileName}` }));
              });
              return;
            }
          }

          next();
        });
      }
    }
  ]
})
