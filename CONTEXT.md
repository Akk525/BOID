# Boid language

Boid analyzes a software product's value flows and tests proposed economic mechanisms against explicit objectives and adversarial behavior.

## Language

**Economic model**:
A versioned, machine-readable description of actors, assets, state, actions, rules, and value flows for one product.
_Avoid_: Token model, prompt output

**Mechanism**:
The rules that determine permitted actions and their economic consequences.
_Avoid_: Tokenomics

**Scenario**:
A versioned set of initial state, population, costs, assumptions, time horizon, and random seed used to evaluate a mechanism.
_Avoid_: Prediction

**Boid**:
A simulated decision maker that controls one or more actor identities and chooses actions to optimize an objective.
_Avoid_: LLM agent, wallet

**Strategy**:
A reproducible sequence or policy of actions available to a boid.
_Avoid_: Prompt

**Finding**:
A falsifiable claim about a mechanism, supported by a strategy or run trace, calculations, and input provenance.
_Avoid_: Insight

**Evidence**:
A value with its source, epistemic category, extraction method, and any uncertainty range.
_Avoid_: Fact when the value is assumed or estimated

**Coalition**:
Actor identities controlled by the same economic decision maker. A coalition may play several roles in a mechanism.
_Avoid_: Wallet cluster when common control is only a hypothesis
