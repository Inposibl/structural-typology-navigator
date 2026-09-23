import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Tikhon Courses Route via Supabase (Batch 0)", () => {
  test("Route queries Supabase tikhon_public_projection and returns valid response shape", async () => {
    // Dynamically test the GET handler using mocked or live Supabase config
    const { GET } = await import("../../src/app/api/tikhon/courses/route.ts");
    const response = await GET();

    assert.equal(response.status, 200, "Response status must be 200");
    const data = await response.json();

    assert.ok(data.as_of, "Must contain as_of");
    assert.equal(data.currency, "RUB", "Currency must be RUB");
    assert.equal(data.currency_symbol, "₽", "Currency symbol must be ₽");
    assert.ok(Array.isArray(data.courses), "Courses must be an array");
    assert.equal(data.courses.length, 5, "Must have exactly 5 active courses");

    const courseIds = data.courses.map((c: { id: string }) => c.id);
    assert.ok(courseIds.includes("structural_typology"));
    assert.ok(courseIds.includes("levels_of_consciousness"));
    assert.ok(courseIds.includes("maslow"));
    assert.ok(courseIds.includes("normative_situation"));
    assert.ok(courseIds.includes("play_and_creativity"));

    // Verify Maslow control values
    const maslow = data.courses.find((c: { id: string }) => c.id === "maslow");
    assert.equal(maslow.meetings_count, 4);
    assert.equal(maslow.pricing_options[0].price, 45000);
    assert.equal(maslow.max_participants, 24);
  });
});
