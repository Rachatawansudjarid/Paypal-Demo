/**
 * PayPal Prototype Server
 * ------------------------------------
 * A tiny Express API that demonstrates:
 * 1) Creating and capturing PayPal Orders ("paying")
 * 2) Crediting a local in-memory wallet after a PayPal deposit
 * 3) Sending money out via PayPal Payouts ("receiving" on the user's side)
 *
 * Quick start:
 *   1) npm init -y && npm i express node-fetch dotenv
 *   2) Set env vars (see below)
 *   3) node server.js
 *
 * Env vars:
 *   PORT=3000
 *   PAYPAL_CLIENT_ID=YourSandboxClientID
 *   PAYPAL_CLIENT_SECRET=YourSandboxSecret
 *   // Use sandbox by default. Switch to live by changing to https://api-m.paypal.com
 *   PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
 *
 * NOTE: This is a prototype for learning/testing only.
 */

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAYPAL_BASE_URL = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.warn("[WARN] Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
}

// -----------------------------
// In-memory wallet store (demo)
// -----------------------------
// { userId: number }
const wallet = new Map();

function getBalance(userId) {
  return wallet.get(userId) ?? 0;
}

function credit(userId, amount) {
  const bal = getBalance(userId);
  wallet.set(userId, bal + amount);
}

function debit(userId, amount) {
  const bal = getBalance(userId);
  if (amount > bal) throw new Error("Insufficient funds");
  wallet.set(userId, bal - amount);
}

// -----------------------------
// PayPal helpers
// -----------------------------
async function getAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function createOrder({ amount, currency = "USD", description = "Test order" }) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: currency, value: String(amount) },
          description,
        },
      ],
      // Minimal server-side prototype. In production use the JS SDK for approval and return/cancel URLs.
      application_context: {
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
        brand_name: "Demo Store",
        landing_page: "NO_PREFERENCE",
        return_url: "https://example.com/return", // placeholder
        cancel_url: "https://example.com/cancel", // placeholder
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create order failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function captureOrder(orderId) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `cap_${orderId}_${Date.now()}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Capture failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Simple Payouts (send money to someone's PayPal email)
async function sendPayout({ email, amount, currency = "USD", note = "Payout" }) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE_URL}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: `batch_${Date.now()}`,
        email_subject: "You have a payout!",
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: email,
          note,
          amount: { value: String(amount), currency },
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Payout failed: ${res.status} ${text}`);
  }
  return res.json();
}

// -----------------------------
// Routes
// -----------------------------

app.get("/api/health", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

// 1) Generic pay flow using Orders API
app.post("/api/pay/create-order", async (req, res) => {
  try {
    const { amount, currency, description } = req.body || {};
    if (!amount) return res.status(400).json({ error: "amount is required" });
    const order = await createOrder({ amount, currency, description });
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pay/capture/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const capture = await captureOrder(orderId);
    res.json(capture);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2) Deposit to local wallet via PayPal
app.post("/api/wallet/deposit/create-order", async (req, res) => {
  try {
    const { userId, amount, currency } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!amount) return res.status(400).json({ error: "amount is required" });

    const order = await createOrder({ amount, currency, description: `Deposit for user ${userId}` });

    // Attach your own metadata mapping if you need to correlate later (e.g., in DB)
    res.json({ userId, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/wallet/deposit/capture/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const capture = await captureOrder(orderId);

    // For demo, sum captured amounts from purchase units (assuming single capture)
    const captured = capture?.purchase_units?.[0]?.payments?.captures?.reduce((sum, c) => sum + parseFloat(c.amount.value), 0) || 0;

    credit(userId, captured);

    res.json({ message: "Deposit captured and credited", userId, credited: captured, balance: getBalance(userId), raw: capture });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/wallet/:userId", (req, res) => {
  const { userId } = req.params;
  res.json({ userId, balance: getBalance(userId) });
});

// 3) Send money out via PayPal Payouts (receiver gets funds to their PayPal account)
app.post("/api/payouts/send", async (req, res) => {
  try {
    const { userId, email, amount, currency, note } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });
    if (amount === undefined || amount === null) return res.status(400).json({ error: "amount is required" });

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "invalid amount" });
    }

    // Deduct from local wallet first (if provided), with clear 400 on insufficient funds
    if (userId) {
      const currentBalance = getBalance(userId);
      if (currentBalance < numericAmount) {
        return res.status(400).json({ error: "Insufficient funds", balance: currentBalance, required: numericAmount });
      }
      debit(userId, numericAmount);
    }

    const result = await sendPayout({ email, amount, currency, note });
    res.json({ message: "Payout submitted", result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Dev-only: credit wallet without PayPal for quick local testing
app.post("/api/wallet/dev/credit", (req, res) => {
  try {
    const { userId, amount } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (amount === undefined || amount === null) return res.status(400).json({ error: "amount is required" });
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "invalid amount" });
    }
    credit(userId, numericAmount);
    res.json({ message: "Wallet credited", userId, amount: numericAmount, balance: getBalance(userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Basic error handler for unknown routes
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

app.listen(PORT, () => {
  console.log(`PayPal prototype running on http://localhost:${PORT}`);
});
