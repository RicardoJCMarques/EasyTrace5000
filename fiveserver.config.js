// fiveserver.config.js

module.exports = {
  port: 5500,
  
  middleware: [
    (req, res, next) => {
      const url = req.url.toLowerCase();

      // MIME TYPE ENFORCEMENT
      if (url.endsWith('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
      }
      else if (url.endsWith('.js')) {
        res.setHeader('Content-Type', 'text/javascript');
      }
      else if (url.endsWith('.json') || url.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/json');
      }
      else if (url.endsWith('.svg')) {
        res.setHeader('Content-Type', 'image/svg+xml');
      }

      // SECURITY HEADERS
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

      next();
    }
  ]
};