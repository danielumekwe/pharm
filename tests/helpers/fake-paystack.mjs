// A local stand-in for Paystack's API: initialize and verify transactions, and list them (connection test).
// Only requests carrying `Bearer <secret>` are accepted, like the real API.
import { createServer } from "node:http";

export async function startFakePaystack(secret) {
  const state = { secret, transactions: new Map(), initialized: [], requests: [], refunds: new Map(), refundStatus: "pending", refundError: null, refundUnreachable: false };
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      state.requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
      const send = (status, payload) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (request.headers.authorization !== `Bearer ${state.secret}`) return send(401, { status: false, message: "Invalid key" });
      if (request.method === "GET" && request.url.startsWith("/transaction?")) return send(200, { status: true, data: [] });
      if (request.method === "POST" && request.url === "/transaction/initialize") {
        const input = JSON.parse(body);
        state.initialized.push(input);
        state.transactions.set(input.reference, { ...input, status: "ongoing", id: state.transactions.size + 1000 });
        return send(200, { status: true, data: { authorization_url: `${state.url}/checkout/${input.reference}`, access_code: "AC", reference: input.reference } });
      }
      if (request.method === "POST" && request.url === "/refund") {
        if (state.refundUnreachable) return request.socket.destroy();
        const input = JSON.parse(body);
        if (state.refundError) return send(400, { status: false, message: state.refundError });
        const transaction = state.transactions.get(input.transaction);
        if (!transaction || transaction.status !== "success") return send(400, { status: false, message: "Transaction not found or not successful" });
        const refund = { id: 7000 + state.refunds.size, status: state.refundStatus, amount: input.amount, currency: input.currency ?? transaction.currency, transaction: input.transaction, merchant_note: input.merchant_note };
        state.refunds.set(String(refund.id), refund);
        return send(200, { status: true, message: "Refund has been queued for processing", data: refund });
      }
      const refundMatch = request.url.match(/^\/refund\/(\d+)$/);
      if (request.method === "GET" && refundMatch) {
        const refund = state.refunds.get(refundMatch[1]);
        return refund ? send(200, { status: true, data: refund }) : send(404, { status: false, message: "Refund not found" });
      }
      const match = request.url.match(/^\/transaction\/verify\/(.+)$/);
      if (request.method === "GET" && match) {
        const transaction = state.transactions.get(decodeURIComponent(match[1]));
        if (!transaction) return send(404, { status: false, message: "Transaction reference not found" });
        return send(200, {
          status: true,
          data: {
            id: transaction.id, status: transaction.status, reference: transaction.reference, amount: transaction.amount, currency: transaction.currency, channel: "card",
            paid_at: new Date().toISOString(), gateway_response: transaction.status === "success" ? "Successful" : "Declined", customer: { customer_code: "CUS_x" },
            authorization: { authorization_code: "AUTH_x", card_type: "visa", last4: "4081", exp_month: "12", exp_year: "2030", reusable: true },
          },
        });
      }
      send(404, { status: false, message: "Not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    get url() {
      return state.url;
    },
    succeed(reference) {
      state.transactions.get(reference).status = "success";
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
