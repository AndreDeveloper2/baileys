# 🔥 Guia Rápido de Configuração Firebase

Este guia mostra como configurar o Firebase para persistência de sessões do WhatsApp.

## Passo a Passo

### 1. Criar Projeto no Firebase

1. Acesse https://console.firebase.google.com/
2. Clique em "Add project" ou use um projeto existente
3. Siga o assistente de criação

### 2. Ativar Firestore

1. No menu lateral, vá em **"Build"** > **"Firestore Database"**
2. Clique em **"Create database"**
3. Escolha modo **"Production"** (ou "Test" para desenvolvimento)
4. Selecione uma região (ex: `southamerica-east1` para Brasil)
5. Aguarde a criação

### 3. Obter Service Account Key

1. No Firebase Console, clique no **ícone de engrenagem** (⚙️) > **"Project settings"**
2. Vá na aba **"Service accounts"**
3. Clique em **"Generate new private key"**
4. Confirme clicando em **"Generate key"**
5. Um arquivo JSON será baixado (ex: `seu-projeto-firebase-adminsdk-xxxxx.json`)

### 4. Configurar no Railway

#### Método Recomendado: Variável de Ambiente

1. No Railway, vá em **"Variables"**
2. Clique em **"New Variable"**
3. Configure:
   - **Nome:** `FIREBASE_SERVICE_ACCOUNT`
   - **Valor:** Abra o arquivo JSON baixado, copie TODO o conteúdo e cole aqui como string
   
   Exemplo do valor:
   ```
   {"type":"service_account","project_id":"meu-projeto","private_key_id":"xxx",...}
   ```

4. Salve

### 5. Configurar Regras de Segurança (Opcional mas Recomendado)

1. No Firestore, vá em **"Rules"**
2. Cole as seguintes regras:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /whatsapp_sessions/{instanceId} {
      // Bloquear acesso público
      // O backend usa Service Account (ignora essas regras)
      allow read, write: if false;
    }
  }
}
```

3. Clique em **"Publish"**

**Nota:** Essas regras bloqueiam acesso público, mas o Firebase Admin SDK (usado pelo backend) ignora essas regras e tem acesso total.

### 6. Verificar Funcionamento

Ao iniciar o servidor, você deve ver:

```
✅ Firebase inicializado via FIREBASE_SERVICE_ACCOUNT
✅ Usando Firebase para persistência de sessões
```

## Estrutura no Firestore

O sistema criará automaticamente:

**Coleção:** `whatsapp_sessions`

**Documentos:** Um documento por `instanceId`

```
whatsapp_sessions/
  ├── user_123/
  │   ├── creds: "{\"me\":{...}}"
  │   ├── keys: "{\"pre-key.0\":{...}}"
  │   ├── instanceId: "user_123"
  │   └── updatedAt: Timestamp
  └── user_456/
      └── ...
```

## Troubleshooting

### Erro: "Firebase não está inicializado"

- Verifique se a variável `FIREBASE_SERVICE_ACCOUNT` está configurada no Railway
- Verifique se o JSON está completo e válido
- Certifique-se de que o Firestore está ativado

### Erro: "Permission denied"

- Verifique se o Service Account tem permissões de "Editor" no projeto
- Verifique as regras do Firestore (mas o Admin SDK deve ignorá-las)

### Sessões não estão sendo salvas

- Verifique os logs do servidor
- Verifique se o Firestore está acessível
- Certifique-se de que não há erros de permissão

## Desenvolvimento Local

Para testar localmente sem Railway:

1. Coloque o arquivo JSON da Service Account na raiz do projeto
2. Renomeie para `firebase-service-account.json`
3. Ou defina a variável `FIREBASE_SERVICE_ACCOUNT` no seu `.env`

**Importante:** Nunca commite o arquivo JSON no Git! (já está no `.gitignore`)

