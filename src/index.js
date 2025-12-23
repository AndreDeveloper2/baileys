const createApp = require('./server');
const path = require('path');
const fs = require('fs').promises;

/**
 * Bootstrap do servidor
 * Inicializa a aplicação e inicia o servidor HTTP
 */
async function startServer() {
  // Verificar se Firebase está configurado
  let usingFirebase = false;
  try {
    const { isInitialized } = require('./whatsapp/firebaseConfig');
    usingFirebase = isInitialized();
  } catch (error) {
    // Firebase não disponível, continuar com filesystem
  }

  // Só criar pasta de sessões se não estiver usando Firebase
  if (!usingFirebase) {
    const sessionsDir = path.join(process.cwd(), 'sessions');
    
    try {
      await fs.mkdir(sessionsDir, { recursive: true });
      console.log('✅ Pasta de sessões criada/verificada:', sessionsDir);
    } catch (error) {
      console.error('❌ Erro ao criar pasta de sessões:', error);
      // Não fazer exit, pode estar usando Firebase
    }
  } else {
    console.log('🔥 Usando Firebase para persistência de sessões');
  }

  // Criar app Express
  const app = createApp();

  // Obter porta (Railway usa PORT, local usa 3000)
  const PORT = process.env.PORT || 3000;

  // Iniciar servidor
  app.listen(PORT, () => {
    console.log('🚀 Servidor Baileys iniciado!');
    console.log(`📡 Porta: ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📱 Endpoint: POST http://localhost:${PORT}/instances/create`);
    console.log('');
    console.log('💡 Aguardando conexões...');
  });
}

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Iniciar servidor
startServer().catch((error) => {
  console.error('❌ Erro ao iniciar servidor:', error);
  process.exit(1);
});

