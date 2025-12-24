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

  // Variável para rastrear se já chamou onReady (evitar chamar múltiplas vezes)
  let readyCalled = false;

  // Handler para eventos de conexão
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin, isOnline, receivedPendingNotifications } = update;

    // Log detalhado para debug
    console.log(`[${instanceId}] 🔄 Connection update:`, {
      connection,
      hasQR: !!qr,
      isNewLogin,
      isOnline,
      receivedPendingNotifications,
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

    // IMPORTANTE: Verificar se é novo login e está online
    if (isNewLogin === true) {
      console.log(`[${instanceId}] 🆕 Novo login detectado!`);
      // Salvar credenciais imediatamente em novo login
      try {
        await saveCreds();
        console.log(`[${instanceId}] 💾 Credenciais salvas após novo login`);
      } catch (error) {
        console.error(`[${instanceId}] ❌ Erro ao salvar após novo login:`, error);
      }
    }

    // Conexão estabelecida E online - AGORA SIM está realmente autenticado
    if (connection === 'open' && isOnline === true) {
      console.log(`[${instanceId}] ✅ WhatsApp conectado E online - autenticação completa!`);
      
      // Verificar se tem usuário
      if (sock.user) {
        console.log(`[${instanceId}] 👤 Usuário autenticado: ${sock.user.id}`);
      }

      // Salvar credenciais finais
      try {
        await saveCreds();
        console.log(`[${instanceId}] 💾 Credenciais finais salvas`);
      } catch (error) {
        console.error(`[${instanceId}] ❌ Erro ao salvar credenciais finais:`, error);
      }

      // Enviar presença para confirmar que está ativo (IMPORTANTE!)
      try {
        await sock.sendPresenceUpdate('available');
        console.log(`[${instanceId}] 📡 Presença atualizada para 'available'`);
      } catch (error) {
        console.error(`[${instanceId}] ⚠️  Erro ao enviar presença:`, error);
      }

      // AGORA sim chamar onReady - quando realmente está online (apenas uma vez)
      if (onReady && !readyCalled) {
        readyCalled = true;
        setTimeout(() => {
          onReady();
          console.log(`[${instanceId}] ✅ onReady chamado - instância pronta para uso`);
        }, 1000); // Pequeno delay para garantir que tudo está pronto
      }
      return;
    }

    // Conexão aberta mas ainda não online - aguardar
    if (connection === 'open' && isOnline !== true) {
      console.log(`[${instanceId}] ⏳ Conectado mas aguardando ficar online (isOnline: ${isOnline})...`);
      // Não chamar onReady ainda - aguardar isOnline: true
      
      // Salvar credenciais mesmo assim (pode estar quase pronto)
      try {
        await saveCreds();
      } catch (error) {
        console.error(`[${instanceId}] ❌ Erro ao salvar credenciais:`, error);
      }
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


  return sock;
}

module.exports = createClient;
