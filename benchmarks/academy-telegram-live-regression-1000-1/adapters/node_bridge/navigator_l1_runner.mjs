// Navigator L1 bridge v3 (CORR3): correct native signatures + root containment.
// Containment (owner section 58): every imported module path is resolved with
// realpath and MUST remain under the authenticated TEST_BASE root; symlink
// escape is rejected; no live-tree fallback exists.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const req = JSON.parse(readFileSync(0, "utf8"));
const out = { act: "L1_EXECUTED", origin: "NAVIGATOR_L1", state: {}, link: null, output: "", tool_api: [], mutations: [], outcome_class: "CLEAN" };

function containedImport(rootReal, rel) {
  const candidate = `${rootReal}/${rel}`;
  // eslint-disable-next-line no-undef
  const real = realpathSync(candidate);
  if (!real.startsWith(rootReal)) {
    throw new Error(`module path escapes TEST_BASE root: ${rel}`);
  }
  statSync(real);
  return import(pathToFileURL(real).href);
}

async function main() {
  const rootReal = realpathSync(req.root);
  const query = String(req.input.query ?? "");
  if (req.operation === "payment_decision") {
    const pp = await containedImport(rootReal, "src/lib/academy/payment-policy.ts");
    const cr = await containedImport(rootReal, "src/lib/academy/course-reference.ts");
    const resolution = cr.resolveCourseReferences(query);
    const intent = pp.hasEnrollmentPaymentIntent(query);
    const act = req.input.act_decision ?? { state: "NAVIGATE" };
    const context = req.input.context ?? {};
    // NATIVE 3-ARGUMENT SIGNATURE: resolveEnrollmentPaymentDecision(query, act, context)
    const decision = pp.resolveEnrollmentPaymentDecision(query, act, context);
    const action = decision && decision.kind === "ACTION" ? decision.action : null;
    out.state = {
      decisionKind: decision ? decision.kind : null,
      courseId: action ? action.courseId : (decision && decision.courseId) || null,
      paymentUrl: action ? action.paymentUrl : null,
      refKind: resolution ? resolution.kind : null,
      courseIds: resolution ? resolution.courseIds : [],
      intentDetected: intent,
    };
    out.link = action ? action.paymentUrl : null;
    out.act = "PAYMENT_DECISION";
    out.origin = "NAVIGATOR_PAYMENT_POLICY";
    out.output = JSON.stringify(out.state);
  } else if (req.operation === "course_reference") {
    const cr = await containedImport(rootReal, "src/lib/academy/course-reference.ts");
    const resolution = cr.resolveCourseReferences(query);
    out.state = { refKind: resolution.kind, courseIds: resolution.courseIds };
    out.act = "COURSE_RESOLUTION";
    out.origin = "COURSE_REFERENCE";
    out.output = JSON.stringify(out.state);
  } else if (req.operation === "authority_price") {
    const cr = await containedImport(rootReal, "src/lib/academy/course-reference.ts");
    const ca = await containedImport(rootReal, "src/lib/academy/commercial-authority.ts");
    const resolution = cr.resolveCourseReferences(query);
    let price = null;
    if (resolution.kind === "ONE") {
      price = ca.getAuthoritativeCoursePrice(resolution.courseIds[0]);
    }
    out.state = {
      refKind: resolution.kind,
      courseIds: resolution.courseIds,
      priceStatus: price ? price.status : "NOT_RESOLVED",
      priceValue: price && price.status === "SUPPORTED" ? price.value : null,
    };
    out.act = "AUTHORITY_LOOKUP";
    out.origin = "COMMERCIAL_AUTHORITY";
    out.output = JSON.stringify(out.state);
  } else {
    out.outcome_class = "TECHNICAL_ERROR";
    out.act = "TECHNICAL_ERROR";
    out.output = "unknown operation";
  }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => {
  out.outcome_class = "TECHNICAL_ERROR";
  out.act = "TECHNICAL_ERROR";
  out.output = `bridge error: ${e && e.message}`;
  process.stdout.write(JSON.stringify(out));
});
