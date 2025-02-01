import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import Shopify from '@shopify/shopify-api';
import cors from 'cors';
import mongoose from 'mongoose';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import morgan from 'morgan';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json());
app.use(morgan('combined'));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Zu viele Anfragen, bitte später versuchen.',
});
app.use(limiter);

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const encryptToken = (token) => {
  const cipher = crypto.createCipher('aes-256-cbc', process.env.ENCRYPTION_KEY);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

const ShopSchema = new mongoose.Schema({
  shop: { type: String, unique: true, index: true },
  accessToken: String,
  minOrderValue: Number,
  surcharge: Number,
  surchargeLabel: { type: Map, of: String },
});

const Shop = mongoose.model('Shop', ShopSchema);

app.get('/', (req, res) => {
  res.send('Mindermengenzuschläge App läuft!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Shopify Auth-Setup mit Berechtigungen für mehrere Shops
app.get('/auth', async (req, res) => {
  const authRoute = await Shopify.Auth.beginAuth(
    req,
    res,
    req.query.shop,
    '/auth/callback',
    false,
    {
      scopes: ['read_orders', 'write_orders', 'read_products', 'write_products', 'read_checkouts', 'write_checkouts'],
    }
  );
  res.redirect(authRoute);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const session = await Shopify.Auth.validateAuthCallback(
      req,
      res,
      req.query
    );
    
    await Shop.findOneAndUpdate(
      { shop: session.shop },
      { shop: session.shop, accessToken: encryptToken(session.accessToken) },
      { upsert: true }
    );
    
    res.redirect('/admin');
  } catch (error) {
    winston.error(error);
    res.status(500).send('Auth failed');
  }
});

// Mindermengenzuschlag prüfen
app.post('/check-cart', async (req, res) => {
  const { shop, cart } = req.body;
  const shopConfig = await Shop.findOne({ shop });
  
  if (!shopConfig) {
    return res.status(400).json({ error: 'Shop not registered' });
  }

  const cartTotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (cartTotal < shopConfig.minOrderValue) {
    return res.json({ surcharge: shopConfig.surcharge, label: shopConfig.surchargeLabel });
  }
  res.json({ surcharge: 0 });
});

// Konfiguration des Mindermengenzuschlags
app.post('/set-config', async (req, res) => {
  const { shop, minOrderValue, surcharge, surchargeLabel } = req.body;
  await Shop.findOneAndUpdate(
    { shop },
    { minOrderValue, surcharge, surchargeLabel },
    { upsert: true }
  );
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
