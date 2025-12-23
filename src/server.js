const express = require('express');
const whatsappRoutes = require('./routes/whatsapp.routes');

/**
 * Cria e configura a aplicação Express
 */
function createApp() {
  const app = express();

  // Middleware para parsing JSON
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Rotas do WhatsApp
  app.use('/', whatsappRoutes);

  // Middleware de erro
  app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: 'Rota não encontrada',
    });
  });

  return app;
}

module.exports = createApp;

