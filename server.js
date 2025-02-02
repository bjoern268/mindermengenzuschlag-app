import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import session from 'express-session';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Verbindung zur Datenbank
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Shopify API Setup
const shopify = shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: ['read_orders', 'write_orders', 'read_products', 'write_products', 'read_checkouts', 'write_checkouts'],
    hostName: process.env.APP_URL.replace(/^https?:\/\//, ""),
    apiVersion: ApiVersion.April24,
});

// Webhook-Registrierung für GDPR
async function registerGDPRWebhooks(session) {
    const webhooks = [
        {
            topic: "CUSTOMERS_DATA_REQUEST",
            address: `${process.env.APP_URL}/shopify/gdpr/customers-data-request`
        },
        {
            topic: "CUSTOMERS_REDACT",
            address: `${process.env.APP_URL}/shopify/gdpr/customers-data-delete`
        },
        {
            topic: "SHOP_REDACT",
            address: `${process.env.APP_URL}/shopify/gdpr/shop-data-delete`
        }
    ];

    for (const webhook of webhooks) {
        try {
            const response = await shopify.webhooks.addHandlers({
                session,
                [webhook.topic]: {
                    deliveryMethod: "http",
                    callbackUrl: webhook.address,
                }
            });
            console.log(`✅ Webhook für ${webhook.topic} registriert:`, response);
        } catch (error) {
            console.error(`❌ Fehler beim Registrieren des Webhooks ${webhook.topic}:`, error);
        }
    }
}

// Erlaubte Ursprünge dynamisch aus der Datenbank abrufen
const Shop = mongoose.model('Shop', new mongoose.Schema({ shop: String }));

const getAllowedOrigins = async () => {
  const shops = await Shop.find({}, 'shop');
  return shops.map((shop) => `https://${shop.shop}`);
};

app.use(async (req, res, next) => {
  const allowedOrigins = await getAllowedOrigins();
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Nicht erlaubte Domain'));
      }
    },
  })(req, res, next);
});

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.get('/', (req, res) => {
  res.send('Mindermengenzuschlag App läuft!');
});

// Auth Callback mit Webhook-Registrierung
app.get('/auth/callback', async (req, res) => {
    try {
        const session = await shopify.auth.validateAuthCallback(req, res, req.query);
        
        await Shop.findOneAndUpdate(
            { shop: session.shop },
            { shop: session.shop, accessToken: session.accessToken },
            { upsert: true }
        );

        await registerGDPRWebhooks(session);

        res.redirect('/admin');
    } catch (error) {
        console.error('❌ Auth-Fehler:', error);
        res.status(500).send('Auth fehlgeschlagen');
    }
});

// Endpunkt für das Anfordern von Kundendaten
app.post('/shopify/gdpr/customers-data-request', async (req, res) => {
    console.log("Kundendaten-Anfrage erhalten:", req.body);
    res.status(200).send("Kundendaten-Anfrage bearbeitet");
});

// Endpunkt für das Löschen von Kundendaten
app.post('/shopify/gdpr/customers-data-delete', async (req, res) => {
    console.log("Kundendaten-Löschanfrage erhalten:", req.body);
    const { customer } = req.body;
    res.status(200).send("Kundendaten gelöscht");
});

// Endpunkt für das Löschen von Shop-Daten
app.post('/shopify/gdpr/shop-data-delete', async (req, res) => {
    console.log("Shop-Daten-Löschanfrage erhalten:", req.body);
    const { shop } = req.body;
    res.status(200).send("Shop-Daten gelöscht");
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
