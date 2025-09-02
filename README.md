# Paypal-Demo
paypal demo for SDA proj

### Choose a user
```bash
USER_ID=u3
curl http://localhost:3000/api/wallet/$USER_ID
```

### A) Receive money internally (no PayPal approval)
- Credit wallet:
```bash
curl -X POST http://localhost:3000/api/wallet/dev/credit \
-H "Content-Type: application/json" \
-d "{\"userId\":\"$USER_ID\",\"amount\":10}"
```
- Verify:
```bash
curl http://localhost:3000/api/wallet/$USER_ID
```

### B) Deposit via PayPal (Checkout approval required)
1) Create order:
```bash
ORDER_ID=$(curl -sX POST http://localhost:3000/api/wallet/deposit/create-order \
-H "Content-Type: application/json" \
-d "{\"userId\":\"$USER_ID\",\"amount\":5.00,\"currency\":\"USD\"}" | jq -r '.order.id'); echo $ORDER_ID
```
2) Approve in browser (Sandbox buyer):
- Open: https://www.sandbox.paypal.com/checkoutnow?token=$ORDER_ID
3) Capture (credits wallet):
```bash
curl -X POST http://localhost:3000/api/wallet/deposit/capture/$ORDER_ID \
-H "Content-Type: application/json" \
-d "{\"userId\":\"$USER_ID\"}"
```
4) Verify balance:
```bash
curl http://localhost:3000/api/wallet/$USER_ID
```

### C) Withdraw to PayPal (Payouts)
- Send payout (debited from wallet first):
```bash
curl -X POST http://localhost:3000/api/payouts/send \
-H "Content-Type: application/json" \
-d "{\"userId\":\"$USER_ID\",\"email\":\"sb-fakeuser@personal.example.com\",\"amount\":\"3.00\",\"currency\":\"USD\"}"
```
- If insufficient funds, you get 400 with details. Top up and retry.

### D) Generic “user paying” (standalone order, not wallet)
1) Create:
```bash
GEN_ORDER_ID=$(curl -sX POST http://localhost:3000/api/pay/create-order \
-H "Content-Type: application/json" \
-d '{"amount":4.00,"currency":"USD","description":"Test purchase"}' | jq -r '.id'); echo $GEN_ORDER_ID
```
2) Approve:
- Open: https://www.sandbox.paypal.com/checkoutnow?token=$GEN_ORDER_ID
3) Capture:
```bash
curl -X POST http://localhost:3000/api/pay/capture/$GEN_ORDER_ID \
-H "Content-Type: application/json"
```

### E) Error-case tests
- Insufficient funds on payout:
```bash
curl -X POST http://localhost:3000/api/payouts/send \
-H "Content-Type: application/json" \
-d "{\"userId\":\"$USER_ID\",\"email\":\"sb-fakeuser@personal.example.com\",\"amount\":\"9999.00\",\"currency\":\"USD\"}"
```
- Invalid amount:
```bash
curl -X POST http://localhost:3000/api/payouts/send \
-H "Content-Type: application/json" \
-d "{\"userId\":\"$USER_ID\",\"email\":\"sb-fakeuser@personal.example.com\",\"amount\":\"-5\",\"currency\":\"USD\"}"
```

Notes:
- Wallet is in-memory; it resets on server restart.
- Use Sandbox buyer credentials to approve orders.
- Payouts are server-side and return a PayPal payout batch with status PENDING.
  
