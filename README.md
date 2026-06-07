# 🕰️ Restaurador de Fotos Antigas · Guia de Deploy

Aplicação web com login Google para restauração e colorização de fotos históricas usando Gemini AI.

---

## 📁 Estrutura do Projeto

```
restaurador/
├── api/
│   └── server.js        ← Backend Node.js (Express + OAuth + Gemini proxy)
├── public/
│   └── index.html       ← Frontend completo
├── package.json
├── .env.example         ← Copiar para .env e preencher
└── README.md
```

---

## ⚙️ Pré-requisitos

- Node.js 18+
- Conta Google
- Conta Vercel (gratuita)

---

## 🔑 Passo 1 · Criar credenciais Google OAuth

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto novo (ou use um existente)
3. Menu lateral → **APIs e serviços** → **Credenciais**
4. Clique em **+ Criar credenciais** → **ID do cliente OAuth**
5. Tipo de aplicativo: **Aplicativo da Web**
6. Nome: `Restaurador Fotos`
7. Em **URIs de redirecionamento autorizados**, adicione:
   - Para dev: `http://localhost:3000/auth/google/callback`
   - Para produção: `https://seu-site.vercel.app/auth/google/callback`
8. Clique em **Criar** e copie o **Client ID** e **Client Secret**

> ⚠️ Ative a **Google+ API** ou **People API** no projeto se pedido.

---

## 🤖 Passo 2 · Obter API Key do Gemini

1. Acesse [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Clique em **Create API key**
3. Copie a chave gerada

---

## 🛠️ Passo 3 · Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env`:

```env
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GEMINI_API_KEY=AIzaSy-xxxxx
SESSION_SECRET=gere_uma_string_aleatoria_longa_aqui
BASE_URL=http://localhost:3000
```

Para gerar um SESSION_SECRET seguro:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 💻 Passo 4 · Testar localmente

```bash
npm install
npm run dev
```

Acesse: [http://localhost:3000](http://localhost:3000)

---

## 🚀 Passo 5 · Deploy na Vercel (gratuito)

### Opção A · Via Vercel CLI

```bash
npm install -g vercel
vercel login
vercel
```

### Opção B · Via GitHub (recomendado)

1. Suba o projeto para um repositório GitHub
2. Acesse [vercel.com](https://vercel.com) → **New Project**
3. Importe o repositório
4. Em **Environment Variables**, adicione todas as variáveis do `.env`:

| Nome                  | Valor                                    |
|-----------------------|------------------------------------------|
| `GOOGLE_CLIENT_ID`    | seu client id                            |
| `GOOGLE_CLIENT_SECRET`| seu client secret                        |
| `GEMINI_API_KEY`      | sua api key                              |
| `SESSION_SECRET`      | string aleatória longa                   |
| `BASE_URL`            | `https://seu-projeto.vercel.app`         |
| `NODE_ENV`            | `production`                             |

5. Clique em **Deploy**

### Após o deploy

- Volte ao [Google Console](https://console.cloud.google.com) → Credenciais → seu OAuth client
- Adicione a URL de produção em **URIs de redirecionamento autorizados**:
  ```
  https://seu-projeto.vercel.app/auth/google/callback
  ```
- Atualize a variável `BASE_URL` na Vercel com a URL real

---

## 🔒 Segurança

- A `GEMINI_API_KEY` fica **apenas no servidor** — nunca exposta ao browser
- Sessões são protegidas com `httpOnly` + `secure` em produção
- Upload de imagens processado em memória (sem salvar em disco)
- Autenticação obrigatória em todas as rotas `/api/*`

---

## 🧪 Rotas da API

| Método | Rota                    | Descrição                          |
|--------|-------------------------|------------------------------------|
| GET    | `/auth/google`          | Inicia login com Google            |
| GET    | `/auth/google/callback` | Callback OAuth                     |
| GET    | `/auth/logout`          | Logout                             |
| GET    | `/api/me`               | Retorna usuário autenticado        |
| POST   | `/api/restaurar`        | Restauração P&B (multipart/foto)   |
| POST   | `/api/colorizar`        | Colorização (JSON com base64)      |

---

## ❓ Problemas comuns

**"redirect_uri_mismatch"** → A URL de callback no Google Console não bate com `BASE_URL`. Verifique os dois.

**"Error: Cannot find module"** → Rode `npm install` antes de subir.

**Imagem não gerada** → Verifique se o modelo `gemini-2.0-flash-preview-image-generation` está disponível na sua região e se a API Key tem permissões.
