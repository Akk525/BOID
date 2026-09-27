# Hand-checked payout oracle

Amounts below are USDC, not micro-USDC. The buyer, creator, and affiliate are three distinct application accounts. For the coalition calculation only, assume one economic decision maker controls all three accounts. Checkout itself does not know this.

| First purchase | Buyer pays | Creator receives | Platform receives | Campaign pays affiliate | Campaign change | Coalition change before external costs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5.00 USDC starter listing | −5.00 | +4.50 | +0.50 | +1.00 | −1.00 | +0.50 |
| 20.00 USDC standard listing | −20.00 | +18.00 | +2.00 | +1.00 | −1.00 | −1.00 |
| 4.00 USDC small listing | −4.00 | +3.60 | +0.40 | +0.00 | +0.00 | −0.40 |

For each qualifying first purchase, assume creating the buyer identity costs **0.15 USDC** and making the transaction costs **0.01 USDC** outside the application's ledger. These are scenario assumptions, not repository facts or transfers in checkout:

- Starter coalition result: `−5.00 + 4.50 + 1.00 − 0.15 − 0.01 = +0.34 USDC`.
- Standard coalition result: `−20.00 + 18.00 + 1.00 − 0.15 − 0.01 = −1.16 USDC`.

The buyer's purchase amount is fully distributed between creator and platform; the affiliate bonus is funded separately. Thus each row conserves the application's total USDC balance. The 5.00 USDC row is a conditional profitable strategy under the stated external costs; it does not establish that real-world identity creation costs 0.15 USDC.
