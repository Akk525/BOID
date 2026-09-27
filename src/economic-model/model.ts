import { createHash } from "node:crypto";
import { z } from "zod";

const Id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const Commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const RelativePath = z.string().min(1).refine(
  (path) => !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === ".." || part === "" || part === "."),
  "must be a normalized relative path",
);
const MicroUsdc = z.string().max(30).regex(/^(0|[1-9][0-9]*)$/);
const PositiveInteger = z.string().max(30).regex(/^[1-9][0-9]*$/);
const DecimalRate = z.string().regex(/^(?:0(?:\.[0-9]{1,18})?|1(?:\.0{1,18})?)$/);
const RationalRate = z.strictObject({
  numerator: MicroUsdc,
  denominator: PositiveInteger,
}).refine((rate) => BigInt(rate.numerator) <= BigInt(rate.denominator), {
  message: "rate numerator must not exceed denominator",
});
const Rate = z.union([DecimalRate, RationalRate]);

const Role = z.enum(["buyer", "creator", "affiliate", "platform", "campaignTreasury"]);
const RepositorySource = z.strictObject({
  type: z.literal("repo"),
  commit: Commit,
  path: RelativePath,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
const Evidence = z.strictObject({
  kind: z.enum([
    "known", "observed", "user_supplied", "estimated", "inferred",
    "unknown_knowable", "fundamentally_uncertain",
  ]),
  source: z.discriminatedUnion("type", [
    RepositorySource,
    z.strictObject({ type: z.literal("user"), recordedAt: z.string().optional() }),
    z.strictObject({ type: z.literal("chain"), uri: z.url(), observedAt: z.string() }),
    z.strictObject({ type: z.literal("external"), uri: z.url(), observedAt: z.string().optional() }),
    z.strictObject({ type: z.literal("calculation"), inputs: z.array(Id).min(1) }),
  ]),
  notes: z.string().optional(),
});

type Predicate =
  | { op: "and"; all: Predicate[] }
  | { op: "gte"; left: "purchase.amount"; right: { parameter: string } }
  | { op: "eq"; left: "buyer.completedPurchases"; right: 0 }
  | { op: "present"; role: "affiliate" }
  | { op: "differentAccount"; left: "buyer"; right: "affiliate" };

const PredicateSchema: z.ZodType<Predicate> = z.lazy(() => z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("and"), all: z.array(PredicateSchema).min(1) }),
  z.strictObject({
    op: z.literal("gte"),
    left: z.literal("purchase.amount"),
    right: z.strictObject({ parameter: Id }),
  }),
  z.strictObject({
    op: z.literal("eq"),
    left: z.literal("buyer.completedPurchases"),
    right: z.literal(0),
  }),
  z.strictObject({ op: z.literal("present"), role: z.literal("affiliate") }),
  z.strictObject({
    op: z.literal("differentAccount"),
    left: z.literal("buyer"),
    right: z.literal("affiliate"),
  }),
]));

const Amount = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("fixed"), parameter: Id }),
  z.strictObject({
    op: z.literal("share"),
    basis: z.literal("purchase.amount"),
    rate: z.strictObject({ parameter: Id }),
  }),
  z.strictObject({
    op: z.literal("remainder"),
    basis: z.literal("purchase.amount"),
    minusRule: Id,
  }),
]);

const ModelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.strictObject({
    repository: RelativePath,
    commit: Commit,
    files: z.array(z.strictObject({ path: RelativePath, sha256: Sha256 })).min(1),
  }),
  assets: z.tuple([z.strictObject({ id: z.literal("USDC"), decimals: z.literal(6) })]),
  actors: z.array(z.strictObject({
    id: Id,
    roles: z.array(Role).min(1),
  })).min(1),
  state: z.strictObject({
    balances: z.strictObject({ asset: z.literal("USDC") }),
    completedPurchases: z.strictObject({ actorRole: z.literal("buyer") }),
  }),
  evidence: z.record(Id, Evidence),
  parameters: z.record(Id, z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("money"), value: MicroUsdc, evidence: Id }),
    z.strictObject({ kind: z.literal("rate"), value: Rate, evidence: Id }),
  ])),
  actions: z.strictObject({
    purchase: z.strictObject({
      transfers: z.array(z.strictObject({
        id: Id,
        from: Role,
        to: Role,
        amount: Amount,
        when: PredicateSchema.optional(),
        evidence: z.array(Id).min(1),
      })).min(1),
    }),
  }),
  constraints: z.strictObject({
    noNegativeBalances: z.literal(true),
    buyerCreatorDifferent: z.strictObject({
      value: z.literal(true),
      evidence: Id,
    }),
  }),
  objectives: z.array(z.strictObject({
    id: Id,
    metric: z.enum(["campaignTreasuryBalance", "creatorEarnings", "platformRevenue"]),
    direction: z.enum(["min", "max"]),
    evidence: Id,
  })),
});

export type EconomicModel = z.infer<typeof ModelSchema>;
const StateSchema = z.strictObject({
  balances: z.record(Id, MicroUsdc),
  completedPurchases: z.record(Id, z.number().int().nonnegative()),
  tick: z.number().int().nonnegative(),
});
const PurchaseActionSchema = z.strictObject({
  type: z.literal("purchase"),
  buyer: Id,
  creator: Id,
  affiliate: Id.optional(),
  amountMicros: PositiveInteger,
});
export type EconomicState = z.infer<typeof StateSchema>;
export type PurchaseAction = z.infer<typeof PurchaseActionSchema>;
export type ModelDiagnostic = { path: string; message: string };

export class EconomicModelValidationError extends Error {
  readonly diagnostics: ModelDiagnostic[];

  constructor(diagnostics: ModelDiagnostic[]) {
    super(`Invalid economic model: ${diagnostics.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
    this.name = "EconomicModelValidationError";
    this.diagnostics = diagnostics;
  }
}

function validateSemantics(model: EconomicModel): ModelDiagnostic[] {
  const errors: ModelDiagnostic[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });
  const evidence = model.evidence;
  const parameters = model.parameters;
  const files = new Set(model.source.files.map((file) => file.path));
  const seenFiles = new Set<string>();

  for (const [index, file] of model.source.files.entries()) {
    if (seenFiles.has(file.path)) add(`source.files.${index}.path`, `duplicate source file ${file.path}`);
    seenFiles.add(file.path);
  }
  for (const [id, item] of Object.entries(evidence)) {
    if (item.kind === "known" && !["repo", "chain"].includes(item.source.type)) {
      add(`evidence.${id}.source`, "known evidence requires a direct repository or chain source");
    }
    if (item.kind === "user_supplied" && item.source.type !== "user") {
      add(`evidence.${id}.source`, "user-supplied evidence requires a user source");
    }
    if (item.kind === "inferred" && item.source.type !== "calculation") {
      add(`evidence.${id}.source`, "inferred evidence requires calculation inputs");
    }
    if (item.source.type === "repo") {
      if (item.source.commit !== model.source.commit) {
        add(`evidence.${id}.source.commit`, "must match the pinned source commit");
      }
      if (!files.has(item.source.path)) {
        add(`evidence.${id}.source.path`, "source path is absent from source.files manifest");
      }
      if (item.source.endLine < item.source.startLine) {
        add(`evidence.${id}.source.endLine`, "must not precede startLine");
      }
    }
    if (item.source.type === "calculation") {
      for (const input of item.source.inputs) {
        if (!Object.hasOwn(evidence, input)) {
          add(`evidence.${id}.source.inputs`, `unknown evidence ${input}`);
        }
      }
    }
  }

  const requireEvidence = (id: string, path: string) => {
    if (!Object.hasOwn(evidence, id)) add(path, `unknown evidence ${id}`);
  };
  const requireParameter = (id: string, kind: "money" | "rate", path: string) => {
    const parameter = Object.hasOwn(parameters, id) ? parameters[id] : undefined;
    if (!parameter) add(path, `unknown parameter ${id}`);
    else if (parameter.kind !== kind) add(path, `requires a ${kind} parameter; ${id} is ${parameter.kind}`);
  };
  for (const [id, parameter] of Object.entries(parameters)) {
    requireEvidence(parameter.evidence, `parameters.${id}.evidence`);
    const kind = Object.hasOwn(evidence, parameter.evidence)
      ? evidence[parameter.evidence]?.kind : undefined;
    if (kind === "unknown_knowable" || kind === "fundamentally_uncertain") {
      add(`parameters.${id}.evidence`, `${kind} evidence cannot justify a point value`);
    }
  }

  const seenActors = new Set<string>();
  const roles = new Set<string>();
  for (const [index, actor] of model.actors.entries()) {
    if (seenActors.has(actor.id)) add(`actors.${index}.id`, `duplicate actor ${actor.id}`);
    seenActors.add(actor.id);
    const actorRoles = new Set<string>();
    for (const role of actor.roles) {
      if (actorRoles.has(role)) add(`actors.${index}.roles`, `duplicate role ${role} on actor ${actor.id}`);
      actorRoles.add(role);
      roles.add(role);
    }
  }
  for (const role of Role.options) {
    if (!roles.has(role)) add("actors", `missing actor role ${role}`);
  }

  const seenRules = new Set<string>();
  const rulesById = new Map<string, EconomicModel["actions"]["purchase"]["transfers"][number]>();
  for (const [index, rule] of model.actions.purchase.transfers.entries()) {
    const path = `actions.purchase.transfers.${index}`;
    if (seenRules.has(rule.id)) add(`${path}.id`, `duplicate transfer rule ${rule.id}`);
    if (rule.from === rule.to) add(path, "transfer endpoints must differ");
    if (rule.amount.op === "fixed") {
      requireParameter(rule.amount.parameter, "money", `${path}.amount.parameter`);
    } else if (rule.amount.op === "share") {
      requireParameter(rule.amount.rate.parameter, "rate", `${path}.amount.rate.parameter`);
    } else {
      const subtracted = rulesById.get(rule.amount.minusRule);
      if (!subtracted) {
        add(`${path}.amount.minusRule`, "remainder must subtract an earlier transfer rule");
      } else if (subtracted.amount.op !== "share" ||
        subtracted.from !== "buyer" || subtracted.to !== "platform" ||
        subtracted.when !== undefined || rule.from !== "buyer" || rule.to !== "creator") {
        add(`${path}.amount.minusRule`, "remainder must subtract an unconditional buyer-to-platform purchase share");
      }
    }
    if (rule.when) validatePredicate(rule.when, `${path}.when`, requireParameter);
    for (const id of rule.evidence) requireEvidence(id, `${path}.evidence`);
    seenRules.add(rule.id);
    rulesById.set(rule.id, rule);
  }
  const buyerRules = model.actions.purchase.transfers.filter((rule) => rule.from === "buyer");
  if (buyerRules.length !== 2 ||
    buyerRules.filter((rule) => rule.amount.op === "share" &&
      rule.to === "platform" && rule.when === undefined).length !== 1 ||
    buyerRules.filter((rule) => rule.amount.op === "remainder" &&
      rule.to === "creator" && rule.when === undefined).length !== 1) {
    add("actions.purchase.transfers", "purchase requires one unconditional buyer-to-platform share and one buyer-to-creator remainder");
  }
  const seenObjectives = new Set<string>();
  for (const [index, objective] of model.objectives.entries()) {
    if (seenObjectives.has(objective.id)) add(`objectives.${index}.id`, `duplicate objective ${objective.id}`);
    seenObjectives.add(objective.id);
    requireEvidence(objective.evidence, `objectives.${index}.evidence`);
  }
  requireEvidence(model.constraints.buyerCreatorDifferent.evidence, "constraints.buyerCreatorDifferent.evidence");
  return errors;
}

function validatePredicate(
  predicate: Predicate,
  path: string,
  requireParameter: (id: string, kind: "money" | "rate", path: string) => void,
): void {
  if (predicate.op === "and") {
    predicate.all.forEach((child, index) =>
      validatePredicate(child, `${path}.all.${index}`, requireParameter));
  } else if (predicate.op === "gte") {
    requireParameter(predicate.right.parameter, "money", `${path}.right.parameter`);
  }
}

export function parseEconomicModel(input: unknown): EconomicModel {
  const model = parseWithDiagnostics(ModelSchema, input);
  const diagnostics = validateSemantics(model);
  if (diagnostics.length) throw new EconomicModelValidationError(diagnostics);
  return model;
}

function parseWithDiagnostics<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new EconomicModelValidationError(parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "$",
      message: issue.message,
    })));
  }
  return parsed.data;
}

export function parseEconomicState(input: unknown): EconomicState {
  return parseWithDiagnostics(StateSchema, input);
}

export function parsePurchaseAction(input: unknown): PurchaseAction {
  return parseWithDiagnostics(PurchaseActionSchema, input);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export function serializeEconomicModel(model: EconomicModel): string {
  return JSON.stringify(sortKeys(parseEconomicModel(model)), null, 2) + "\n";
}

export function hashEconomicModel(model: EconomicModel): string {
  return createHash("sha256").update(serializeEconomicModel(model)).digest("hex");
}
