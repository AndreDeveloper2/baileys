const admin = require('firebase-admin');

/**
 * Inicializa o Firebase Admin SDK
 * Suporta dois métodos de autenticação:
 * 1. Service Account Key (JSON) via variável de ambiente FIREBASE_SERVICE_ACCOUNT
 * 2. Service Account JSON file via variável de ambiente GOOGLE_APPLICATION_CREDENTIALS
 */
function initializeFirebase() {
  // Verificar se já foi inicializado
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  try {
    // Método 1: Service Account via variável de ambiente (JSON string)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      
      console.log('✅ Firebase inicializado via FIREBASE_SERVICE_ACCOUNT');
      return admin.firestore();
    }

    // Método 2: Service Account via arquivo (Railway ou local)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      
      console.log('✅ Firebase inicializado via GOOGLE_APPLICATION_CREDENTIALS');
      return admin.firestore();
    }

    // Não tentar inicializar automaticamente - só usar se explicitamente configurado
    throw new Error(
      'Firebase não configurado. Configure FIREBASE_SERVICE_ACCOUNT ou GOOGLE_APPLICATION_CREDENTIALS'
    );
  } catch (error) {
    console.error('❌ Erro ao inicializar Firebase:', error.message);
    throw error;
  }
}

// Inicializar automaticamente ao importar
let db = null;
let initializationAttempted = false;

try {
  db = initializeFirebase();
  initializationAttempted = true;
} catch (error) {
  console.warn('⚠️  Firebase não inicializado. Usar filesystem local como fallback.');
  initializationAttempted = true;
  db = null;
}

module.exports = {
  getFirestore: () => {
    if (!db && !initializationAttempted) {
      try {
        db = initializeFirebase();
        initializationAttempted = true;
      } catch (error) {
        initializationAttempted = true;
        throw error;
      }
    }
    if (!db) {
      throw new Error('Firebase não está inicializado');
    }
    return db;
  },
  isInitialized: () => db !== null,
};

