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

async function createClient(instanceId, onQR, onReady, onDisconnect) {
  let state, saveCreds;

  if (firebaseAvailable && useFirebaseAuthState) {
    try {
      const authState = await useFirebaseAuthState(instanceId);
      state = authState.state;
      saveCreds = authState.saveCreds;
      console.log(`[${instanceId}] 🔥 Usando Firebase para persistência`);
    } catch (error) {
      console.error(`[${instanceId}] ❌ Erro ao usar Firebase, tentando filesystem:`, error.message);
      firebaseAvailable = false;
    }
  }

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

  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    qrTimeout: 60_000,
    markOnlineOnConnect: true,
    // CORREÇÃO 1: Browser mais realista
    browser: ['WhatsApp', 'Chrome', '120.0.0.0'],
    getMessage: async (key) => {
      return undefined;
    },
    // CORREÇÃO 2: Adicionar configurações de conexão mais robustas
    maxMsToWaitForConnection: 10_000,
    fetchMessagesOnWaiting: true,
    downloadHistory: false,
    shouldIgnoreJid: (jid) => {
      // Ignorar alguns JIDs para evitar sobrecarga
      return jid === 'status@broadcast' || jid.endsWith('@s.whatsapp.net') === false;
    },
  });

  sock.ev.on('creds.update', async () => {
    console.log(`[${instanceId}] 📝 Credenciais atualizadas, salvando...`);
    try {
      await saveCreds();
      console.log(`[${instanceId}] ✅ Credenciais salvas com sucesso`);
    } catch (error) {
      console.error(`[${instanceId}] ❌ Erro ao salvar credenciais:`, error);
    }
  });

  let readyCalled = false;
  let connectionStartTime = null;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin, isOnline } = update;

    console.log(`[${instanceId}] 🔄 Connection update:`, {
      connection,
      hasQR: !!qr,
      isNewLogin,
      isOnline,
      error: lastDisconnect?.error?.message || null
    });

    // QR Code gerado
    if (qr) {
      console.log(`[${instanceId}] 🔐 QR Code recebido`);
      connectionStartTime = Date.now();
      if (onQR) {
        onQR(qr);
      }
      return;
    }

    // NOVO LOGIN
    if (isNewLogin === true) {
      console.log(`[${instanceId}] 🆕 Novo login detectado!`);
      try {
        await saveCreds();
        console.log(`[${instanceId}] 💾 Credenciais salvas após novo login`);
      } catch (error) {
        console.error(`[${instanceId}] ❌ Erro ao salvar após novo login:`, error);
      }
    }

    // CONECTANDO
    if (connection === 'connecting') {
      console.log(`[${instanceId}] 🔌 Conectando ao WhatsApp...`);
      if (!connectionStartTime) {
        connectionStartTime = Date.now();
      }
      
      // CORREÇÃO 3: Timeout para evitar "conectando" infinito
      const elapsed = Date.now() - connectionStartTime;
      if (elapsed > 45000) { // 45 segundos de "conectando"
        console.warn(`[${instanceId}] ⏱️  Timeout na conexão - recriando cliente`);
        // Fechar conexão e recriar
        try {
          await sock.end();
        } catch (e) {}
        return;
      }
      return;
    }

    // CONEXÃO ABERTA
    if (connection === 'open') {
      const elapsed = connectionStartTime ? (Date.now() - connectionStartTime) / 1000 : 0;
      console.log(`[${instanceId}] ✅ Conexão aberta (${elapsed.toFixed(1)}s)`);

      // CORREÇÃO 4: Aguardar um pouco para garantir que socket.user está disponível
      await new Promise(resolve => setTimeout(resolve, 2000));

      const hasUser = !!sock.user;
      console.log(`[${instanceId}] Verificando autenticação:`, { hasUser, userId: sock.user?.id });

      if (hasUser) {
        console.log(`[${instanceId}] 👤 Usuário autenticado: ${sock.user.id}`);
        
        // CORREÇÃO 5: Enviar presença antes de chamar onReady
        try {
          await sock.sendPresenceUpdate('available');
          console.log(`[${instanceId}] 📡 Presença enviada`);
        } catch (error) {
          console.error(`[${instanceId}] ⚠️  Erro ao enviar presença:`, error);
        }

        try {
          await saveCreds();
          console.log(`[${instanceId}] 💾 Credenciais finais salvas`);
        } catch (error) {
          console.error(`[${instanceId}] ❌ Erro ao salvar credenciais finais:`, error);
        }

        // Chamar onReady apenas uma vez
        if (onReady && !readyCalled) {
          readyCalled = true;
          console.log(`[${instanceId}] ✅ onReady chamado - instância pronta!`);
          onReady();
        }
        return;
      } else {
        console.warn(`[${instanceId}] ⏳ Conexão aberta mas socket.user ainda não disponível`);
        // Aguardar mais um pouco
        setTimeout(async () => {
          if (sock.user && !readyCalled) {
            console.log(`[${instanceId}] ✅ socket.user detectado após espera!`);
            try {
              await sock.sendPresenceUpdate('available');
              await saveCreds();
            } catch (error) {
              console.error(`[${instanceId}] Erro:`, error);
            }
            
            if (onReady && !readyCalled) {
              readyCalled = true;
              onReady();
              console.log(`[${instanceId}] ✅ onReady chamado`);
            }
          }
        }, 3000);
        return;
      }
    }

    // CONEXÃO FECHADA
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[${instanceId}] ❌ Conexão fechada. Status: ${statusCode}`, lastDisconnect?.error?.message || '');

      if (shouldReconnect) {
        console.log(`[${instanceId}] 🔄 Reconectando em 5s...`);
        setTimeout(() => {
          createClient(instanceId, onQR, onReady, onDisconnect);
        }, 5000);
      } else {
        console.log(`[${instanceId}] ❌ Logout permanente`);
        if (onDisconnect) onDisconnect(true);
      }
      return;
    }
  });

  sock.ev.on('error', (error) => {
    console.error(`[${instanceId}] ❌ Socket error:`, error.message || error);
  });

  sock.ev.on('messaging-history.set', () => {
    console.log(`[${instanceId}] 📨 Histórico de mensagens carregado`);
  });

  return sock;
}

module.exports = createClient;