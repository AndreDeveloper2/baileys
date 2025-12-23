const createClient = require('./createClient');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs').promises;

/**
 * Gerenciador de múltiplas instâncias WhatsApp
 * Mantém um mapa de instâncias ativas e gerencia suas conexões
 */
class WhatsAppManager {
  constructor() {
    // Mapa: instanceId -> { socket, connected, qr }
    this.instances = new Map();
  }

  /**
   * Cria ou retorna uma instância existente
   * @param {string} instanceId - ID único da instância
   * @returns {Promise<object>} Objeto com status e QR code (se necessário)
   */
  async createInstance(instanceId) {
    // Se já existe e está conectada, retornar status
    if (this.instances.has(instanceId)) {
      const instance = this.instances.get(instanceId);
      
      if (instance.connected) {
        return {
          status: 'connected',
          connected: true,
        };
      }

      // Se existe mas não está conectada, retornar QR atual se houver
      if (instance.qr) {
        const qrBase64 = await QRCode.toDataURL(instance.qr);
        return {
          status: 'qr',
          base64: qrBase64,
        };
      }
    }

    // Verificar se já existe sessão persistida
    // Tentar Firebase primeiro, depois filesystem
    let hasExistingSession = false;

    try {
      // Tentar verificar no Firebase
      const { getFirestore, isInitialized } = require('./firebaseConfig');
      if (isInitialized()) {
        const db = getFirestore();
        const sessionRef = db.collection('whatsapp_sessions').doc(instanceId);
        const doc = await sessionRef.get();
        
        if (doc.exists) {
          const data = doc.data();
          hasExistingSession = !!(data && data.creds && data.creds.trim() !== '');
          if (hasExistingSession) {
            console.log(`[${instanceId}] 🔥 Sessão encontrada no Firebase`);
          }
        }
      }
    } catch (error) {
      // Se Firebase não estiver disponível, tentar filesystem
      const sessionPath = path.join(process.cwd(), 'sessions', instanceId);
      try {
        const files = await fs.readdir(sessionPath);
        hasExistingSession = files.length > 0;
        if (hasExistingSession) {
          console.log(`[${instanceId}] 📁 Sessão encontrada no filesystem`);
        }
      } catch (fsError) {
        // Pasta não existe, não há sessão
        hasExistingSession = false;
      }
    }

    // Se já tem sessão, tentar reconectar automaticamente
    if (hasExistingSession && !this.instances.has(instanceId)) {
      console.log(`[${instanceId}] Sessão existente encontrada. Reconectando...`);
      
      // Criar instância sem gerar QR (vai tentar reconectar)
      return this._setupInstance(instanceId, false);
    }

    // Criar nova instância (vai gerar QR)
    return this._setupInstance(instanceId, true);
  }

  /**
   * Configura uma instância do WhatsApp
   * @param {string} instanceId - ID da instância
   * @param {boolean} expectQR - Se deve esperar QR code
   * @returns {Promise<object>} Status da instância
   */
  async _setupInstance(instanceId, expectQR) {
    return new Promise((resolve) => {
      let qrGenerated = false;
      let readyCalled = false;
      let resolved = false;
      let timeoutId = null;

      const safeResolve = (data) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          resolve(data);
        }
      };

      const onQR = async (qr) => {
        if (qrGenerated) return; // Evitar gerar múltiplos QRs
        qrGenerated = true;

        console.log(`[${instanceId}] QR Code gerado`);

        const qrBase64 = await QRCode.toDataURL(qr);

        // Salvar QR na instância
        const instance = this.instances.get(instanceId) || {};
        instance.qr = qr;
        this.instances.set(instanceId, instance);

        if (expectQR) {
          safeResolve({
            status: 'qr',
            base64: qrBase64,
          });
        }
      };

      const onReady = () => {
        if (readyCalled) return;
        readyCalled = true;

        const instance = this.instances.get(instanceId);
        if (instance) {
          instance.connected = true;
          instance.qr = null; // Limpar QR após conectar
          this.instances.set(instanceId, instance);
        }

        console.log(`[${instanceId}] Instância pronta para uso`);

        // Se não esperávamos QR mas conectou, resolver como conectado
        if (!expectQR && !resolved) {
          safeResolve({
            status: 'connected',
            connected: true,
          });
        }
      };

      const onDisconnect = (loggedOut) => {
        if (loggedOut) {
          // Se foi logout, remover instância
          this.instances.delete(instanceId);
          console.log(`[${instanceId}] Instância removida (logout)`);
        } else {
          // Apenas atualizar status
          const instance = this.instances.get(instanceId);
          if (instance) {
            instance.connected = false;
            this.instances.set(instanceId, instance);
          }
        }
      };

      // Timeout para evitar que a promise fique pendente indefinidamente
      if (expectQR) {
        // Se esperamos QR, aguardar até 30 segundos
        timeoutId = setTimeout(() => {
          if (!resolved) {
            console.warn(`[${instanceId}] ⏱️  Timeout aguardando QR code (30s)`);
            safeResolve({
              status: 'error',
              error: 'Timeout aguardando QR code. Tente novamente.',
            });
          }
        }, 30000);
      } else {
        // Se não esperamos QR, aguardar até 10 segundos para reconexão
        timeoutId = setTimeout(() => {
          if (!resolved) {
            const inst = this.instances.get(instanceId);
            if (inst && inst.connected) {
              safeResolve({
                status: 'connected',
                connected: true,
              });
            } else {
              console.warn(`[${instanceId}] ⏱️  Timeout aguardando conexão (10s)`);
              safeResolve({
                status: 'error',
                error: 'Timeout aguardando conexão. Pode precisar gerar novo QR code.',
              });
            }
          }
        }, 10000);
      }

      // Criar cliente
      createClient(instanceId, onQR, onReady, onDisconnect)
        .then((socket) => {
          // Salvar socket na instância
          const instance = {
            socket,
            connected: false,
            qr: null,
          };
          this.instances.set(instanceId, instance);

          console.log(`[${instanceId}] Socket criado, aguardando eventos...`);

          // Se já está conectado, resolver imediatamente
          if (socket.user) {
            console.log(`[${instanceId}] Já conectado (socket.user existe)`);
            onReady();
            if (!expectQR && !resolved) {
              safeResolve({
                status: 'connected',
                connected: true,
              });
            }
          } else if (!expectQR) {
            // Aguardar um pouco para ver se conecta automaticamente (com sessão existente)
            setTimeout(() => {
              if (!resolved) {
                const inst = this.instances.get(instanceId);
                if (inst && inst.connected) {
                  safeResolve({
                    status: 'connected',
                    connected: true,
                  });
                } else {
                  // Se não conectou, aguardar mais - o timeout vai resolver
                  console.log(`[${instanceId}] Ainda não conectou, aguardando...`);
                }
              }
            }, 5000);
          }
        })
        .catch((error) => {
          console.error(`[${instanceId}] ❌ Erro ao criar cliente:`, error);
          this.instances.delete(instanceId);
          safeResolve({
            status: 'error',
            error: error.message || 'Erro desconhecido ao criar cliente',
          });
        });
    });
  }

  /**
   * Obtém status de uma instância
   * @param {string} instanceId - ID da instância
   * @returns {object} Status da instância
   */
  getInstanceStatus(instanceId) {
    if (!this.instances.has(instanceId)) {
      return {
        connected: false,
        exists: false,
      };
    }

    const instance = this.instances.get(instanceId);
    return {
      connected: instance.connected || false,
      exists: true,
    };
  }

  /**
   * Obtém socket de uma instância conectada
   * @param {string} instanceId - ID da instância
   * @returns {object|null} Socket do Baileys ou null
   */
  getSocket(instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance || !instance.connected) {
      return null;
    }
    return instance.socket;
  }

  /**
   * Remove uma instância
   * @param {string} instanceId - ID da instância
   */
  async deleteInstance(instanceId) {
    const instance = this.instances.get(instanceId);
    
    if (instance && instance.socket) {
      try {
        await instance.socket.logout();
      } catch (error) {
        console.error(`[${instanceId}] Erro ao fazer logout:`, error);
      }
    }

    // Remover da memória
    this.instances.delete(instanceId);

    // Remover sessão do disco (opcional - comentado para manter sessão)
    // const sessionPath = path.join(process.cwd(), 'sessions', instanceId);
    // try {
    //   await fs.rm(sessionPath, { recursive: true, force: true });
    // } catch (error) {
    //   console.error(`[${instanceId}] Erro ao remover sessão:`, error);
    // }
  }

  /**
   * Lista todas as instâncias ativas
   * @returns {Array} Lista de instanceIds
   */
  listInstances() {
    return Array.from(this.instances.keys());
  }
}

// Singleton
const manager = new WhatsAppManager();

module.exports = manager;

