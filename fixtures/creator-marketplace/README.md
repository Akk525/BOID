# Creator marketplace fixture

This is a small, fictional existing application for Boid to analyze. Buyers purchase creator listings using integer micro-USDC accounting. Checkout sends 90% of the price to the creator and 10% to the platform. A separate campaign treasury pays a fixed 1 USDC affiliate bonus when a referred buyer makes their first purchase of at least 5 USDC. The ordinary listing price is 20 USDC.

The application does not pay an affiliate bonus when a buyer refers themself with the same account ID. It has no evidence that three different accounts are controlled by three different people. That distinction is deliberately outside the checkout rule.

## Run

Node 20 or newer; no dependency installation is needed.

```sh
cd fixtures/creator-marketplace
npm test
node --input-type=module -e "import { checkout } from './src/checkout.mjs'; import { sampleState } from './src/sample-data.mjs'; console.log(checkout(sampleState(), { buyerId: 'buyer-1', listingId: 'starter', affiliateId: 'affiliate-1' }).receipt)"
```

The public application operation is `checkout(state, order)`. It returns a new state and receipt; it does not mutate its input. The small state shape is intentionally visible for later model-extraction work.

Rules can be traced to [campaign configuration](src/config.mjs), [referral eligibility](src/referrals.mjs), and [checkout settlement](src/checkout.mjs). The [independent oracle](ORACLE.md) works out the relevant examples by hand. It is a test target, not attack logic in the application.

The fixture uses an application-owned ledger to express the economics. It is not a Solana program, a wallet identity system, or a production payment service.
