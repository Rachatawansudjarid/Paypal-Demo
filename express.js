// routes/payouts.js (example)
import express from "express";
import paypalClient from "./paypalClient.js";
import { getUserById, updateUserBalance } from "./db.js";

const router = express.Router();

// Send payout
router.post("/send", async (req, res) => {
  const { userId, email, amount, currency } = req.body;

  try {
    const user = await getUserById(userId);

    // ✅ Validate and normalize numeric fields
    const numericAmount = Number(amount);
    const numericBalance = Number(user?.balance ?? 0);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!Number.isFinite(numericBalance) || numericBalance < numericAmount) {
      return res.status(400).json({
        error: "Insufficient funds",
        details: { availableBalance: numericBalance, required: numericAmount },
      });
    }

    const request = new paypal.payouts.PayoutsPostRequest();
    request.requestBody({
      sender_batch_header: {
        sender_batch_id: `batch_${Date.now()}`,
        email_subject: "You have a payout!",
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: {
            value: numericAmount.toFixed(2),
            currency_code: currency || "USD",
          },
          receiver: email,
          note: "Payout from demo app",
        },
      ],
    });

    const response = await paypalClient.execute(request);

    // Deduct from local wallet
    await updateUserBalance(userId, numericBalance - numericAmount);

    res.json({
      message: "Payout sent",
      batchId: response.result.batch_header.payout_batch_id,
      userId,
      newBalance: numericBalance - numericAmount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Payout failed", details: err.message });
  }
});

export default router;
