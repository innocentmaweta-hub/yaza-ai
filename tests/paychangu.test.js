import test from "node:test";
import assert from "node:assert/strict";
import { verifyAndCreditTopup } from "../lib/paychangu.js";

const txRef = "YAZA-123e4567-e89b-12d3-a456-426614174000";
const topup = () => ({ user_id: "user-1", tx_ref: txRef, amount_mwk: 1000, status: "pending" });

function makeAdmin(row) {
  const state = { row, rpcCalls: [], updateCalls: [] };
  const admin = {
    from(table) {
      if (table !== "payment_topups") throw new Error("Unexpected table: " + table);
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: state.row, error: null }) }; } };
        },
        update(values) {
          return { eq: async () => {
            state.updateCalls.push(values);
            Object.assign(state.row, values);
            return { error: null };
          } };
        }
      };
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return { data: [{ credited: true, balance_minor: args.p_amount_mwk * 100 }], error: null };
    }
  };
  return { admin, state };
}

async function withVerifiedPayment(amount, run) {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.PAYCHANGU_SECRET_KEY;
  process.env.PAYCHANGU_SECRET_KEY = "test-secret";
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: "success",
    data: { tx_ref: txRef, status: "success", currency: "MWK", amount, reference: "PAY-REF-1" }
  }), { status: 200, headers: { "content-type": "application/json" } });
  try { return await run(); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.PAYCHANGU_SECRET_KEY;
    else process.env.PAYCHANGU_SECRET_KEY = originalSecret;
  }
}

test("credits the exact verified MWK amount", async () => {
  await withVerifiedPayment(1000, async () => {
    const { admin, state } = makeAdmin(topup());
    const result = await verifyAndCreditTopup(admin, txRef);
    assert.equal(result.status, "success");
    assert.equal(state.rpcCalls[0].args.p_amount_mwk, 1000);
    assert.equal(state.updateCalls[0].status, "success");
  });
});

test("credits the full verified amount when PayChangu overpays", async () => {
  await withVerifiedPayment(1250, async () => {
    const { admin, state } = makeAdmin(topup());
    const result = await verifyAndCreditTopup(admin, txRef);
    assert.equal(result.status, "success");
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].args.p_amount_mwk, 1250);
    assert.equal(state.rpcCalls[0].args.p_metadata.excess_credited_mwk, 250);
  });
});

test("does not credit when the verified amount is below the requested top-up", async () => {
  await withVerifiedPayment(999, async () => {
    const { admin, state } = makeAdmin(topup());
    await assert.rejects(() => verifyAndCreditTopup(admin, txRef), /below the requested top-up/);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.updateCalls.length, 0);
  });
});
