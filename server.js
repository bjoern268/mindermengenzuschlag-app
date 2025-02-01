import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import session from 'express-session';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Verbindung zur Datenbank
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

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

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
