# Reviewed SPL payout assumptions

- Reviewed client settlement, not onchain enforcement of rates or referral policy.
- Buyer owner signs purchase debits; treasury owner signs affiliate debits; fee payer signs and pays SOL fees.
- Trusted offchain eligibility authority: aJH4wogwxveCqzDK2M3Q84xko8iTAo5hXen9ARfzqsN. First-purchase state and referral attestation come from this service.
- Distinct account addresses do not prove independent users. Receipt persistence, concurrency and crash recovery require application integration.
- Award is debited from campaign treasury, including when its amount is sized from platform fees.
- SPL Token only; six decimals; no Token-2022 extensions, PDA derivation, escrow or deployment.
- Bindings are declarations to review, not proof that these accounts exist or are controlled by the listed owners.
