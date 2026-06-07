require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const passport   = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const multer     = require('multer');
const fetch      = require('node-fetch');
const path       = require('path');
const cors       = require('cors');

const app  = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
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
    maxAge: 24 * 60 * 60 * 1000 // 24h
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
  // Salva só o necessário na sessão
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
  res.json({ authenticated: true, user: req.user });
});

// ─── Auth Guard ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Não autenticado. Faça login com Google.' });
}

// ─── Gemini Proxy: Restauração ─────────────────────────────────────────────────
app.post('/api/restaurar', requireAuth, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma foto enviada.' });

    const base64 = req.file.buffer.toString('base64');
    const mime   = req.file.mimetype;

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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inline_data: { mime_type: mime, data: base64 } },
              { text: prompt }
            ]
          }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        })
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Erro na API Gemini' });
    }

    const data = await response.json();
    const imgPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);

    if (!imgPart) return res.status(502).json({ error: 'Gemini não retornou imagem.' });

    res.json({
      image: imgPart.inlineData.data,
      mime:  imgPart.inlineData.mimeType
    });

  } catch (err) {
    console.error('[restaurar]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Gemini Proxy: Colorização ─────────────────────────────────────────────────
app.post('/api/colorizar', requireAuth, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { image, mime } = req.body;
    if (!image) return res.status(400).json({ error: 'Imagem não enviada.' });

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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inline_data: { mime_type: mime || 'image/png', data: image } },
              { text: prompt }
            ]
          }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        })
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Erro na API Gemini' });
    }

    const data = await response.json();
    const imgPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);

    if (!imgPart) return res.status(502).json({ error: 'Gemini não retornou imagem colorizada.' });

    res.json({
      image: imgPart.inlineData.data,
      mime:  imgPart.inlineData.mimeType
    });

  } catch (err) {
    console.error('[colorizar]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✦ Restaurador de Fotos rodando em http://localhost:${PORT}\n`);
});

module.exports = app;
