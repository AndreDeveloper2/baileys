const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs').promises;

// Tentar importar Firebase AuthState
let useFirebaseAuthState = null;
let firebaseAvailable = false;

try {
  useFirebaseAuthState = require('./firebaseAuthState');
  const { isInitialized } = require('./firebaseConfig');
  firebaseAvailable = isInitialized();
  
  if (firebaseAvailable) {
    console.log('✅ Usando Firebase para persistência de sessões');
  } else {
    console.log('⚠️  Firebase não configurado. Usando filesystem local como fallback');
  }
} catch (error) {
  console.log('⚠️  Firebase não disponível. Usando filesystem local como fallback');
}

/**
 * Cria uma conexão WhatsApp usando Baileys
 * @param {string} instanceId - ID único da instância
 * @param {function} onQR - Callback quando QR code for gerado
 * @param {function} onReady - Callback quando conexão estiver pronta
 * @param {function} onDisconnect - Callback quando desconectar
 * @returns {Promise<object>} Socket do Baileys
 */
async function createClient(instanceId, onQR, onReady, onDisconnect) {
  let state, saveCreds;

  // Tentar usar Firebase primeiro, fallback para filesystem
  if (firebaseAvailable && useFirebaseAuthState) {
    try {
      const authState = await useFirebaseAuthState(instanceId);
      state = authState.state;
      saveCreds = authState.saveCreds;
      console.log(`[${instanceId}] 🔥 Usando Firebase para persistência`);
    } catch (error) {
      console.error(`[${instanceId}] ❌ Erro ao usar Firebase, tentando filesystem:`, error.message);
      // Fallback para filesystem
      firebaseAvailable = false;
    }
  }

  // Fallback: usar filesystem local
  if (!firebaseAvailable) {
    const sessionPath = path.join(process.cwd(), 'sessions', instanceId);
    
    try {
      await fs.mkdir(sessionPath, { recursive: true });
    } catch (error) {
      console.error(`[${instanceId}] Erro ao criar pasta de sessão:`, error);
    }

    const authState = await useMultiFileAuthState(sessionPath);
    state = authState.state;
    saveCreds = authState.saveCreds;
    console.log(`[${instanceId}] 📁 Usando filesystem local para persistência`);
  }

  // Obter versão mais recente do Baileys
  const { version } = await fetchLatestBaileysVersion();

  // Criar logger
  const logger = pino({ level: 'silent' }); // Silenciar logs do Baileys

  // Criar socket do WhatsApp com configurações otimizadas para estabilidade
  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false, // Não imprimir QR no terminal
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    // Configurações para melhorar estabilidade da conexão
    connectTimeoutMs: 60_000, // 60 segundos para conectar
    defaultQueryTimeoutMs: 60_000, // 60 segundos para queries
    keepAliveIntervalMs: 10_000, // Keep-alive a cada 10 segundos
    qrTimeout: 60_000, // 60 segundos para QR code
    markOnlineOnConnect: true, // Marcar como online ao conectar
    browser: ['Baileys Server', 'Chrome', '1.0.0'], // User agent
    getMessage: async (key) => {
      // Retornar undefined para não tentar baixar mensagens antigas
      return undefined;
    },
  });

  // Salvar credenciais quando atualizadas (CRÍTICO para manter sessão)
  sock.ev.on('creds.update', async () => {
    console.log(`[${instanceId}] 🔐 Credenciais atualizadas, salvando...`);
    try {
      await saveCreds();
      console.log(`[${instanceId}] ✅ Credenciais salvas com sucesso`);
    } catch (error) {
      console.error(`[${instanceId}] ❌ Erro ao salvar credenciais:`, error);
    }
  });

  // Handler para eventos de conexão
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr, isNewLogin, isOnline } = update;

    // Log detalhado para debug
    console.log(`[${instanceId}] 🔄 Connection update:`, {
      connection,
      hasQR: !!qr,
      isNewLogin,
      isOnline,
      error: lastDisconnect?.error?.message || lastDisconnect?.error?.output?.statusCode || null
    });

    // QR Code gerado
    if (qr) {
      console.log(`[${instanceId}] 📱 QR Code recebido, processando...`);
      if (onQR) {
        onQR(qr);
      }
      return;
    }

    // Conexão estabelecida
    if (connection === 'open') {
      console.log(`[${instanceId}] ✅ WhatsApp conectado com sucesso!`);
      
      // Aguardar um pouco para garantir que a autenticação completa
      setTimeout(async () => {
        // Salvar credenciais novamente após conexão estabelecida
        try {
          await saveCreds();
          console.log(`[${instanceId}] 💾 Credenciais finais salvas após autenticação completa`);
        } catch (error) {
          console.error(`[${instanceId}] ❌ Erro ao salvar credenciais finais:`, error);
        }
        
        // Verificar se realmente está autenticado
        if (sock.user) {
          console.log(`[${instanceId}] ✅ Autenticação completa! Usuário: ${sock.user.id}`);
        } else {
          console.warn(`[${instanceId}] ⚠️  Conectado mas ainda não autenticado completamente`);
        }
      }, 2000); // Aguardar 2 segundos após conexão
      
      if (onReady) onReady();
      return;
    }

    // Conexão fechada
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `[${instanceId}] ❌ Conexão fechada. Status: ${statusCode || 'undefined'}`,
        lastDisconnect?.error?.message || ''
      );

      if (shouldReconnect) {
        console.log(`[${instanceId}] 🔄 Tentando reconectar em 5 segundos...`);
        // Reconectar após 5 segundos (aumentado para dar mais tempo)
        setTimeout(() => {
          createClient(instanceId, onQR, onReady, onDisconnect);
        }, 5000);
      } else {
        console.log(`[${instanceId}] ❌ Desconectado permanentemente (logado out).`);
        // Se foi logout, remover sessão
        if (onDisconnect) onDisconnect(true);
      }
      return;
    }

    // Outros estados de conexão
    if (connection === 'connecting') {
      console.log(`[${instanceId}] 🔌 Conectando ao WhatsApp...`);
      return;
    }

    if (connection === 'close' || connection === null || connection === undefined) {
      // Aguardar QR ou outros eventos antes de considerar como erro
      return;
    }
  });

  // Handler para erros
  sock.ev.on('error', (error) => {
    console.error(`[${instanceId}] ❌ Erro no socket:`, error.message || error);
    if (error.stack) {
      console.error(`[${instanceId}] Stack:`, error.stack);
    }
  });

  // Handler para eventos de mensagens (para debug de autenticação)
  sock.ev.on('messaging-history.set', () => {
    console.log(`[${instanceId}] 📨 Histórico de mensagens carregado - autenticação avançando`);
  });

  // Handler para quando receber informações do usuário (autenticação completa)
  sock.ev.on('creds.update', async () => {
    console.log(`[${instanceId}] 🔐 Credenciais sendo atualizadas durante autenticação...`);
  });

  return sock;
}

module.exports = createClient;
