const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');
const { getFirestore, isInitialized } = require('./firebaseConfig');

const COLLECTION_NAME = 'whatsapp_sessions';

/**
 * Cria um AuthState customizado usando Firebase Firestore
 * Substitui o useMultiFileAuthState para persistência na nuvem
 * 
 * @param {string} instanceId - ID único da instância
 * @returns {Promise<{state: object, saveCreds: function}>}
 */
async function useFirebaseAuthState(instanceId) {
  if (!isInitialized()) {
    throw new Error(
      'Firebase não está inicializado. Configure as credenciais do Firebase.'
    );
  }

  const db = getFirestore();
  const sessionRef = db.collection(COLLECTION_NAME).doc(instanceId);
  
  let creds = null;
  let keys = {};

  try {
    // Carregar dados do Firestore
    const doc = await sessionRef.get();
    
    if (doc.exists) {
      const data = doc.data();
      
      // Restaurar credenciais
      if (data.creds) {
        try {
          creds = JSON.parse(data.creds, BufferJSON.reviver);
        } catch (e) {
          console.warn(`[${instanceId}] Erro ao parsear creds, usando novas`);
        }
      }
      
      // Restaurar chaves
      if (data.keys) {
        try {
          keys = JSON.parse(data.keys, BufferJSON.reviver);
        } catch (e) {
          console.warn(`[${instanceId}] Erro ao parsear keys, usando novas`);
          keys = {};
        }
      }
      
      console.log(`[${instanceId}] ✅ Sessão carregada do Firebase`);
    } else {
      console.log(`[${instanceId}] 📝 Nova sessão - criando credenciais`);
    }
  } catch (error) {
    console.error(`[${instanceId}] ❌ Erro ao carregar sessão do Firebase:`, error.message);
    // Continuar com credenciais vazias se houver erro
  }

  // Se não há credenciais, inicializar novas
  if (!creds) {
    creds = initAuthCreds();
  }

  // Função para salvar credenciais no Firebase
  const saveCreds = async () => {
    try {
      const dataToSave = {
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keys, BufferJSON.replacer),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        instanceId: instanceId,
      };

      await sessionRef.set(dataToSave, { merge: true });
      console.log(`[${instanceId}] 💾 Sessão salva no Firebase`);
    } catch (error) {
      console.error(`[${instanceId}] ❌ Erro ao salvar sessão no Firebase:`, error.message);
      // Não lançar erro para não interromper o fluxo do Baileys
    }
  };

  // Criar função helper para construir chave
  const getKey = (type, ids) => {
    return JSON.stringify([type, ...ids], BufferJSON.reviver);
  };

  // Criar objeto keys compatível com Baileys
  const keysObj = {
    get: (type, ids) => {
      const key = getKey(type, ids);
      const value = keys[key];
      if (!value) return null;
      
      try {
        // Usar reviver para restaurar Buffers e outros tipos especiais
        return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
      } catch (e) {
        return value;
      }
    },
    set: async (data) => {
      for (const category in data) {
        for (const jid in data[category]) {
          const key = getKey(category, [jid]);
          // Usar replacer para serializar Buffers corretamente
          keys[key] = JSON.parse(
            JSON.stringify(data[category][jid], BufferJSON.replacer),
            BufferJSON.reviver
          );
        }
      }
      // Salvar automaticamente quando as chaves são atualizadas
      await saveCreds();
    },
  };

  // Criar função saveCreds que sempre lê os valores atuais
  const saveCredsWrapper = async () => {
    try {
      const dataToSave = {
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keys, BufferJSON.replacer),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        instanceId: instanceId,
      };

      await sessionRef.set(dataToSave, { merge: true });
      console.log(`[${instanceId}] 💾 Sessão salva no Firebase`);
    } catch (error) {
      console.error(`[${instanceId}] ❌ Erro ao salvar sessão no Firebase:`, error.message);
      // Não lançar erro para não interromper o fluxo do Baileys
    }
  };

  return {
    state: {
      creds,
      keys: keysObj,
    },
    saveCreds: saveCredsWrapper,
  };
}

module.exports = useFirebaseAuthState;
