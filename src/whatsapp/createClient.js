const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const path = require("path");
const fs = require("fs").promises;

let useFirebaseAuthState = null;
let firebaseAvailable = false;

try {
  useFirebaseAuthState = require("./firebaseAuthState");
  const { isInitialized } = require("./firebaseConfig");
  firebaseAvailable = isInitialized();

  if (firebaseAvailable) {
    console.log("✅ Usando Firebase para persistência de sessões");
  } else {
    console.log(
      "⚠️  Firebase não configurado. Usando filesystem local como fallback"
    );
  }
} catch (error) {
  console.log(
    "⚠️  Firebase não disponível. Usando filesystem local como fallback"
  );
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
      console.error(
        `[${instanceId}] ❌ Erro ao usar Firebase, tentando filesystem:`,
        error.message
      );
      firebaseAvailable = false;
    }
  }

  if (!firebaseAvailable) {
    const sessionPath = path.join(process.cwd(), "sessions", instanceId);

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
  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // ⚠️ CRÍTICO: Disfarçar como cliente mobile real
    // WhatsApp bloqueia se detectar servidor
    browser: Browsers.windows("Chrome"),
    mobile: false,

    // Anti-detecção
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 15_000,
    qrTimeout: 60_000,
    markOnlineOnConnect: true,

    // ⚠️ IMPORTANTE: Adicionar delays aleatórios (parece mais natural)
    retryRequestDelayMs: 100 + Math.random() * 200,

    getMessage: async (key) => {
      return undefined;
    },

    shouldIgnoreJid: (jid) => {
      return (
        jid === "status@broadcast" || jid.endsWith("@s.whatsapp.net") === false
      );
    },
  });

  sock.ev.on("creds.update", async () => {
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

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    console.log(`[${instanceId}] 🔄 Connection update:`, {
      connection,
      hasQR: !!qr,
      isNewLogin,
      error: lastDisconnect?.error?.message || null,
    });

    // QR Code gerado
    if (qr) {
      console.log(
        `[${instanceId}] 🔐 QR Code recebido - escaneie com o celular`
      );
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
      } catch (error) {
        console.error(
          `[${instanceId}] ❌ Erro ao salvar após novo login:`,
          error
        );
      }
    }

    // CONECTANDO
    if (connection === "connecting") {
      console.log(`[${instanceId}] 🔌 Conectando ao WhatsApp...`);
      if (!connectionStartTime) {
        connectionStartTime = Date.now();
      }

      const elapsed = Date.now() - connectionStartTime;
      if (elapsed > 45000) {
        console.warn(
          `[${instanceId}] ⏱️  Timeout na conexão (45s) - recriando cliente`
        );
        try {
          await sock.end();
        } catch (e) {}
        return;
      }
      return;
    }

    // CONEXÃO ABERTA
    if (connection === "open") {
      const elapsed = connectionStartTime
        ? (Date.now() - connectionStartTime) / 1000
        : 0;
      console.log(
        `[${instanceId}] ✅ Conexão aberta com WhatsApp (${elapsed.toFixed(
          1
        )}s)`
      );

      // Aguardar socket.user estar disponível
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasUser = !!sock.user;
      console.log(`[${instanceId}] 🔍 Verificando autenticação:`, {
        hasUser,
        userId: sock.user?.id || "undefined",
      });

      if (hasUser) {
        console.log(`[${instanceId}] 👤 Usuário autenticado: ${sock.user.id}`);

        // Enviar presença para confirmar autenticação
        try {
          await sock.sendPresenceUpdate("available");
          console.log(`[${instanceId}] 📡 Status enviado como 'available'`);
        } catch (error) {
          console.warn(
            `[${instanceId}] ⚠️  Erro ao enviar presença:`,
            error.message
          );
        }

        // Salvar credenciais
        try {
          await saveCreds();
          console.log(`[${instanceId}] 💾 Credenciais finais salvas`);
        } catch (error) {
          console.error(
            `[${instanceId}] ❌ Erro ao salvar credenciais:`,
            error
          );
        }

        // Chamar onReady apenas uma vez
        if (onReady && !readyCalled) {
          readyCalled = true;
          console.log(`[${instanceId}] ✅ onReady chamado - instância pronta!`);
          onReady();
        }
        return;
      } else {
        console.warn(
          `[${instanceId}] ⏳ Conectado ao WhatsApp mas socket.user ainda não disponível`
        );
        // Aguardar mais um pouco
        setTimeout(async () => {
          if (sock.user && !readyCalled) {
            console.log(
              `[${instanceId}] ✅ socket.user detectado! Autenticando...`
            );
            try {
              await sock.sendPresenceUpdate("available");
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
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `[${instanceId}] ❌ Conexão fechada. Status: ${statusCode}`,
        lastDisconnect?.error?.message || ""
      );

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

  sock.ev.on("error", (error) => {
    console.error(`[${instanceId}] ❌ Socket error:`, error.message || error);
  });

  sock.ev.on("messaging-history.set", () => {
    console.log(`[${instanceId}] 📨 Histórico de mensagens carregado`);
  });

  return sock;
}

module.exports = createClient;
