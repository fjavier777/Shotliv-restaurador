require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const passport   = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const multer     = require('multer');
const fetch      = require('node-fetch');
const path       = require('path');
const cors       = require('cors');

const app    = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.BASE_URL, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// ─── Passport Google OAuth ─────────────────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  `${process.env.BASE_URL}/auth/google/callback`
}, (accessToken, refreshToken, profile, done) => {
  return done(null, {
    id:     profile.id,
    name:   profile.displayName,
    email:  profile.emails?.[0]?.value,
    avatar: profile.photos?.[0]?.value
  });
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ─── Auth Routes ───────────────────────────────────────────────────────────────
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?erro=auth' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ authenticated: false });
  // Informa se o usuário já tem API Key salva na sessão
  res.json({
    authenticated: true,
    user: req.user,
    hasApiKey: !!req.session.geminiApiKey
  });
});

// ─── Salvar API Key na sessão ──────────────────────────────────────────────────
app.post('/api/apikey', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Não autenticado.' });
  const { apiKey } = req.body;
  if (!apiKey || !apiKey.startsWith('AIza')) {
    return res.status(400).json({ error: 'API Key inválida. Deve começar com "AIza".' });
  }
  req.session.geminiApiKey = apiKey;
  res.json({ ok: true });
});

// ─── Remover API Key da sessão ─────────────────────────────────────────────────
app.delete('/api/apikey', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Não autenticado.' });
  delete req.session.geminiApiKey;
  res.json({ ok: true });
});

// ─── Auth + API Key Guard ──────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.isAuthenticated())
    return res.status(401).json({ error: 'Não autenticado. Faça login com Google.' });
  if (!req.session.geminiApiKey)
    return res.status(403).json({ error: 'API Key do Gemini não configurada.' });
  next();
}

// ─── Chamada Gemini centralizada ───────────────────────────────────────────────
async function callGemini(apiKey, parts) {
  const model = 'gemini-2.5-flash-image';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro HTTP ${resp.status}`);
  }
  const data    = await resp.json();
  const imgPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!imgPart) throw new Error('Gemini não retornou imagem.');
  return { image: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType };
}

// ─── Restauração ───────────────────────────────────────────────────────────────
app.post('/api/restaurar', requireAuth, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma foto enviada.' });

    const base64 = req.file.buffer.toString('base64');
    const mime   = req.file.mimetype;
    const apiKey = req.session.geminiApiKey;

    const prompt = `Você é um especialista em restauração de fotografias históricas.
Receba esta foto antiga e aplique os seguintes ajustes de restauração profissional:

CONVERSÃO PARA PRETO E BRANCO PURO:
- Converter para P&B verdadeiro, removendo toda tonalidade sépia/amarelada
- B&W Mix: Amarelos -15 (escurece áreas que amarelaram), Laranjas/Vermelhos +10 (tons de pele naturais)

AJUSTES DE LUZ E CONTRASTE:
- Exposição: +0.15 (foto ligeiramente subexposta)
- Contraste: +15 (separar melhor os elementos)
- Realces (Highlights): -10 (proteger fundo claro e superfícies brancas)
- Sombras (Shadows): +5 (recuperar detalhes em cabelos e roupas escuras)
- Pretos (Blacks): -12 (garantir pretos verdadeiros, eliminar aspecto lavado)
- Brancos (Whites): +8 (brilho nas áreas claras)

DETALHES E PRESERVAÇÃO:
- Clareza (Clarity): +10 (definir bordas de roupas e objetos ao fundo)
- Desembaçar (Dehaze): +5 (remover névoa do envelhecimento)
- Redução de Ruído (Luminância): 15 (suavizar textura do papel antigo)
- Detalhe: 50 (manter traços firmes dos rostos)
- Rotação: +0.5° à direita (corrigir inclinação sutil)

REMOÇÃO DE DEFEITOS:
- Remover manchas brancas de poeira e desgaste
- Eliminar riscos e arranhões visíveis
- Corrigir dobras ou danos no papel

Gere a imagem restaurada com máxima qualidade, preservando caráter histórico e detalhes dos rostos.`;

    const result = await callGemini(apiKey, [
      { inline_data: { mime_type: mime, data: base64 } },
      { text: prompt }
    ]);

    res.json(result);

  } catch (err) {
    console.error('[restaurar]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Colorização ───────────────────────────────────────────────────────────────
app.post('/api/colorizar', requireAuth, async (req, res) => {
  try {
    const { image, mime } = req.body;
    if (!image) return res.status(400).json({ error: 'Imagem não enviada.' });

    const apiKey = req.session.geminiApiKey;

    const prompt = `Você é um especialista em colorização de fotografias históricas em preto e branco.
Analise esta fotografia restaurada e aplique colorização realista e natural seguindo estas diretrizes:

PELE E PESSOAS:
- Tons de pele quentes e naturais, adequados ao contexto histórico (anos 1960)
- Lábios com cor rosada natural
- Cabelos com cor marrom escuro natural

ROUPAS:
- Vestido feminino: preto sólido elegante
- Terno masculino: cinza-bege claro típico dos anos 60
- Gravata: cor escura (verde musgo ou bordô)
- Camisa masculina: branco/creme

AMBIENTE:
- Fundo/parede: bege ou branco envelhecido cálido
- Armário/móvel de madeira ao fundo: tom mogno escuro
- Toalha de mesa: branco ou creme
- Louças e cristais: reflexos naturais

COPOS / BEBIDA:
- Taças de cristal translúcido com reflexos dourados
- Bebida: tom âmbar dourado (champagne ou vinho branco)

QUALIDADE:
- Colorização suave e fotorrealista, não cartoon
- Preservar toda a nitidez e detalhes dos rostos restaurados
- Manter o clima elegante e nostálgico da época
- Iluminação coerente com a fonte de luz original

Gere a imagem colorizada com qualidade máxima, fiel ao período histórico dos anos 1960.`;

    const result = await callGemini(apiKey, [
      { inline_data: { mime_type: mime || 'image/png', data: image } },
      { text: prompt }
    ]);

    res.json(result);

  } catch (err) {
    console.error('[colorizar]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✦ Restaurador de Fotos rodando em http://localhost:${PORT}\n`);
});

module.exports = app;
