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

  // Criar socket do WhatsApp
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
  });

  // Salvar credenciais quando atualizadas
  sock.ev.on('creds.update', saveCreds);

  // Handler para eventos de conexão
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR Code gerado
    if (qr) {
      if (onQR) onQR(qr);
      return;
    }

    // Conexão estabelecida
    if (connection === 'open') {
      console.log(`[${instanceId}] ✅ WhatsApp conectado com sucesso!`);
      if (onReady) onReady();
      return;
    }

    // Conexão fechada
    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log(
        `[${instanceId}] Conexão fechada. Status:`,
        lastDisconnect?.error?.output?.statusCode
      );

      if (shouldReconnect) {
        console.log(`[${instanceId}] 🔄 Tentando reconectar...`);
        // Reconectar após 3 segundos
        setTimeout(() => {
          createClient(instanceId, onQR, onReady, onDisconnect);
        }, 3000);
      } else {
        console.log(`[${instanceId}] ❌ Desconectado permanentemente (logado out).`);
        // Se foi logout, remover sessão
        if (onDisconnect) onDisconnect(true);
      }
      return;
    }

    // Conexão conectando
    if (connection === 'connecting') {
      console.log(`[${instanceId}] 🔌 Conectando...`);
      return;
    }
  });

  // Handler para erros
  sock.ev.on('error', (error) => {
    console.error(`[${instanceId}] ❌ Erro no socket:`, error);
  });

  return sock;
}

module.exports = createClient;
