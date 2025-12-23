# Baileys Server - Microserviço WhatsApp

Microserviço Node.js para integração com WhatsApp usando a biblioteca **Baileys**. Suporta múltiplas instâncias simultâneas, cada uma com sua sessão isolada persistida em disco.

## 🎯 Características

- ✅ Conexão WhatsApp via Baileys
- ✅ Geração de QR Code em base64
- ✅ Suporte a múltiplas instâncias (multi-tenant)
- ✅ **Persistência de sessões no Firebase Firestore** (ou filesystem local)
- ✅ Reconexão automática após restart/redeploy
- ✅ API REST simples
- ✅ Pronto para deploy no Railway
- ✅ Sessões sobrevivem a reinicializações do container

## 📋 Pré-requisitos

- Node.js 18+
- npm ou yarn
- **Firebase Project** (opcional, mas recomendado para produção)

## 🚀 Instalação

1. Clone o repositório:
```bash
git clone <seu-repositorio>
cd baileys
```

2. Instale as dependências:
```bash
npm install
```

3. **(Opcional) Configure Firebase** (recomendado para produção):
   
   Veja a seção [🔥 Configuração do Firebase](#-configuração-do-firebase) abaixo.

4. Inicie o servidor:
```bash
npm start
```

Ou em modo desenvolvimento (com watch):
```bash
npm run dev
```

O servidor estará rodando em `http://localhost:3000` (ou na porta definida em `PORT`).

**Nota:** Se o Firebase não estiver configurado, o sistema usará o filesystem local como fallback.

## 📡 Endpoints da API

### 1. Criar Instância / Gerar QR Code

Cria uma nova instância WhatsApp ou retorna status de uma existente.

**POST** `/instances/create`

**Body:**
```json
{
  "instanceId": "user_123"
}
```

**Resposta (QR Code necessário):**
```json
{
  "status": "qr",
  "base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

**Resposta (Já conectado):**
```json
{
  "status": "connected",
  "connected": true
}
```

---

### 2. Status da Instância

Verifica se uma instância está conectada.

**GET** `/instances/:instanceId/status`

**Resposta:**
```json
{
  "connected": true
}
```

---

### 3. Enviar Mensagem

Envia uma mensagem de texto via WhatsApp.

**POST** `/messages/send`

**Body:**
```json
{
  "instanceId": "user_123",
  "to": "5511999999999",
  "message": "Olá, sua fatura venceu"
}
```

**Resposta:**
```json
{
  "success": true
}
```

**Observações:**
- O número `to` pode ser fornecido com ou sem formatação (apenas números ou com caracteres especiais)
- O sistema remove automaticamente caracteres não numéricos
- O número deve incluir código do país (ex: 55 para Brasil)

---

### 4. Listar Instâncias (Debug)

Lista todas as instâncias ativas.

**GET** `/instances`

**Resposta:**
```json
{
  "instances": [
    {
      "instanceId": "user_123",
      "connected": true,
      "exists": true
    }
  ]
}
```

---

### 5. Remover Instância

Remove uma instância (faz logout).

**DELETE** `/instances/:instanceId`

**Resposta:**
```json
{
  "success": true,
  "message": "Instância removida com sucesso"
}
```

---

### 6. Health Check

Verifica se o servidor está rodando.

**GET** `/health`

**Resposta:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

---

## 📱 Como Usar

### Passo 1: Criar Instância e Obter QR Code

```bash
curl -X POST http://localhost:3000/instances/create \
  -H "Content-Type: application/json" \
  -d '{
    "instanceId": "user_123"
  }'
```

A resposta conterá um QR Code em base64. Você pode:

1. **Decodificar em HTML:**
```html
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..." />
```

2. **Salvar como imagem:**
```javascript
const fs = require('fs');
const base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...";
const data = base64.replace(/^data:image\/\w+;base64,/, '');
fs.writeFileSync('qrcode.png', data, 'base64');
```

### Passo 2: Escanear QR Code

1. Abra o WhatsApp no celular
2. Vá em **Configurações > Aparelhos conectados > Conectar um aparelho**
3. Escaneie o QR Code gerado

### Passo 3: Verificar Status

```bash
curl http://localhost:3000/instances/user_123/status
```

### Passo 4: Enviar Mensagem

```bash
curl -X POST http://localhost:3000/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "instanceId": "user_123",
    "to": "5511999999999",
    "message": "Olá, sua fatura venceu"
  }'
```

---

## 🔥 Configuração do Firebase

Para usar persistência de sessões no Firebase (recomendado para produção no Railway), siga os passos abaixo.

### 1. Criar Projeto Firebase

1. Acesse [Firebase Console](https://console.firebase.google.com/)
2. Crie um novo projeto ou use um existente
3. Ative o **Firestore Database**
   - Vá em "Build" > "Firestore Database"
   - Clique em "Create database"
   - Escolha modo "Production" ou "Test"
   - Selecione uma região

### 2. Obter Service Account Key

1. No Firebase Console, vá em **Project Settings** (ícone de engrenagem)
2. Aba **Service Accounts**
3. Clique em **Generate new private key**
4. Baixe o arquivo JSON

### 3. Configurar Credenciais

#### Opção A: Variável de Ambiente (Recomendado para Railway)

No Railway, adicione uma variável de ambiente:

```
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"seu-projeto",...}
```

O valor deve ser o conteúdo completo do JSON da Service Account como uma string.

#### Opção B: Arquivo Local (Desenvolvimento)

1. Renomeie o arquivo baixado para `firebase-service-account.json`
2. Coloque na raiz do projeto (ou defina `GOOGLE_APPLICATION_CREDENTIALS` apontando para ele)
3. **Nunca commite este arquivo!** (já está no `.gitignore`)

#### Opção C: Via GOOGLE_APPLICATION_CREDENTIALS

Defina a variável de ambiente apontando para o arquivo:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="./firebase-service-account.json"
```

### 4. Estrutura no Firestore

O sistema criará automaticamente uma coleção chamada `whatsapp_sessions` no Firestore.

Cada documento terá:
- **ID do documento:** `instanceId` (ex: "user_123")
- **Campos:**
  - `creds`: Credenciais do WhatsApp (string JSON)
  - `keys`: Chaves de criptografia (string JSON)
  - `updatedAt`: Timestamp de atualização
  - `instanceId`: ID da instância

### 5. Regras de Segurança Firestore (Importante!)

Configure as regras do Firestore para proteger as sessões:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /whatsapp_sessions/{instanceId} {
      // Permitir leitura/escrita apenas pelo backend (Service Account)
      // Nunca permita acesso público!
      allow read, write: if false;
    }
  }
}
```

Como estamos usando **Firebase Admin SDK**, as regras acima bloqueiam acesso público mas permitem acesso via Service Account.

### 6. Verificar Configuração

Ao iniciar o servidor, você verá:

```
✅ Firebase inicializado via FIREBASE_SERVICE_ACCOUNT
✅ Usando Firebase para persistência de sessões
```

Se não estiver configurado:

```
⚠️  Firebase não configurado. Usando filesystem local como fallback
📁 Usando filesystem local para persistência
```

### Vantagens do Firebase

- ✅ Sessões sobrevivem a restart/redeploy no Railway
- ✅ Compartilhamento entre múltiplos containers (escala horizontal)
- ✅ Backup automático no Firebase
- ✅ Não depende do filesystem volátil do Railway

---

## 🚂 Deploy no Railway

### Método 1: Via Railway CLI

1. Instale o Railway CLI:
```bash
npm i -g @railway/cli
```

2. Faça login:
```bash
railway login
```

3. Inicialize o projeto:
```bash
railway init
```

4. Faça deploy:
```bash
railway up
```

### Método 2: Via GitHub

1. Faça push do código para um repositório GitHub
2. Acesse [Railway](https://railway.app)
3. Crie um novo projeto
4. Selecione "Deploy from GitHub repo"
5. Escolha seu repositório
6. Railway detectará automaticamente o `package.json` e fará deploy

### Configurações no Railway

1. **Variáveis de Ambiente:**

   O Railway automaticamente:
   - ✅ Detecta Node.js
   - ✅ Usa `npm start` para iniciar
   - ✅ Define a variável `PORT` automaticamente

2. **Configurar Firebase (Recomendado):**

   Para persistência de sessões no Firebase:
   - Adicione a variável `FIREBASE_SERVICE_ACCOUNT` com o conteúdo completo do JSON da Service Account
   - Ou configure `GOOGLE_APPLICATION_CREDENTIALS` se usar arquivo (menos recomendado)

   **Como adicionar variável no Railway:**
   1. Vá em "Variables" no seu projeto
   2. Clique em "New Variable"
   3. Nome: `FIREBASE_SERVICE_ACCOUNT`
   4. Valor: Cole o conteúdo completo do JSON da Service Account (como string)

**Importante:** Sem Firebase configurado, as sessões serão perdidas a cada restart/redeploy no Railway!

---

## 📂 Estrutura do Projeto

```
baileys-server/
├── src/
│   ├── index.js                # Bootstrap do servidor
│   ├── server.js               # Configuração Express
│   ├── whatsapp/
│   │   ├── manager.js          # Gerenciador de instâncias
│   │   ├── createClient.js     # Criação de conexão Baileys
│   │   ├── firebaseConfig.js   # Configuração Firebase Admin
│   │   ├── firebaseAuthState.js # AuthState customizado para Firebase
│   │   └── sessions/           # Sessões persistidas (fallback, se não usar Firebase)
│   └── routes/
│       └── whatsapp.routes.js  # Rotas HTTP
├── sessions/                   # Pasta de sessões (fallback, se não usar Firebase)
├── package.json
├── .gitignore
└── README.md
```

---

## 🔒 Segurança

- ⚠️ **Importante:** Este serviço gerencia conexões WhatsApp reais. Mantenha a segurança:
  - Use HTTPS em produção
  - Implemente autenticação/autorização nos endpoints
  - Não exponha o serviço publicamente sem proteção
  - Mantenha as sessões seguras (a pasta `sessions/` contém credenciais)

---

## 🔄 Como Funciona

1. **Criação de Instância:**
   - Verifica se já existe uma sessão persistida (Firebase ou filesystem)
   - Se existe, tenta reconectar automaticamente **sem gerar novo QR**
   - Se não existe, gera QR Code para primeira conexão

2. **Persistência:**
   - **Com Firebase:** Credenciais salvas no Firestore (`whatsapp_sessions/{instanceId}`)
   - **Sem Firebase:** Credenciais salvas em `sessions/{instanceId}/` (filesystem local)
   - Sessões sobrevivem a reinicializações do servidor/redeploy
   - Para desconectar permanentemente, use DELETE `/instances/:instanceId`

3. **Reconexão:**
   - Se a conexão cair, o sistema tenta reconectar automaticamente
   - Mantém as sessões salvas para reconexão rápida
   - **Com Firebase:** Sessões são compartilhadas entre múltiplos containers

4. **Fluxo de Conexão:**
   - Usuário chama `POST /instances/create` com `instanceId`
   - Sistema verifica se existe sessão no Firebase/Filesystem
   - Se existe sessão válida → Conecta automaticamente (sem QR)
   - Se não existe → Gera QR Code → Usuário escaneia → Sessão salva → Pronto!

---

## 🐛 Troubleshooting

### QR Code não aparece
- Verifique se a instância foi criada corretamente
- Aguarde alguns segundos, o QR pode levar tempo para gerar
- Se já existe sessão, a instância pode conectar automaticamente sem QR

### Instância não conecta
- Verifique se escaneou o QR Code no WhatsApp
- Verifique os logs do servidor
- Tente remover a instância e criar novamente

### Mensagem não envia
- Verifique se a instância está conectada (`GET /instances/:instanceId/status`)
- Verifique o formato do número (deve incluir código do país)
- Verifique os logs do servidor para erros

---

## 📝 Licença

MIT

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou pull requests.

---

**Desenvolvido com ❤️ usando Baileys**

