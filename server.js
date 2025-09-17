const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const port = Number(process.env.PORT || 3000);
const publicDir = path.resolve(__dirname, 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, headers, bodyStream) {
  res.writeHead(status, headers);
  if (bodyStream) bodyStream.pipe(res); else res.end();
}

function notFound(res) {
  const file = path.join(publicDir, '404.html');
  fs.stat(file, (err, stats) => {
    if (!err && stats.isFile()) {
      send(res, 404, { 'Content-Type': 'text/html; charset=utf-8' }, fs.createReadStream(file));
    } else {
      const msg = '404 Not Found';
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(msg) });
      res.end(msg);
    }
  });
}

function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url || '/');
  let pathname = decodeURIComponent(parsed.pathname || '/');

  // Normalize and prevent path traversal
  const relPath = pathname.replace(/^\/+/, '');
  const safePath = path.normalize(path.join(publicDir, relPath));
  if (!isPathInside(publicDir, safePath) && safePath !== publicDir) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  fs.stat(safePath, (err, stats) => {
    if (err) {
      // Try serving index.html for SPA-style routes
      const fallback = path.join(publicDir, 'index.html');
      return fs.stat(fallback, (e2, s2) => {
        if (!e2 && s2.isFile()) {
          send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, fs.createReadStream(fallback));
        } else {
          notFound(res);
        }
      });
    }

    let filePath = safePath;
    if (stats.isDirectory()) {
      filePath = path.join(safePath, 'index.html');
      return fs.stat(filePath, (e3, s3) => {
        if (e3 || !s3.isFile()) return notFound(res);
        const ext = path.extname(filePath).toLowerCase();
        const type = CONTENT_TYPES[ext] || 'application/octet-stream';
        send(res, 200, { 'Content-Type': type }, fs.createReadStream(filePath));
      });
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = CONTENT_TYPES[ext] || 'application/octet-stream';

    // Basic caching for static assets
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    send(res, 200, headers, fs.createReadStream(filePath));
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
