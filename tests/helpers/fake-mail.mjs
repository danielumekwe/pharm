// Local stand-ins for ZeptoMail's send API and for an SMTP server, so email tests send nothing real.
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";

/** ZeptoMail API: accepts `Zoho-enczapikey <token>`, rejects an empty body as invalid, and can be told to fail. */
export async function startFakeZepto(token) {
  const state = { token, sent: [], requests: [], failNext: 0 };
  const server = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      state.requests.push({ url: request.url, authorization: request.headers.authorization, body });
      const send = (status, payload) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (request.method !== "POST" || request.url !== "/v1.1/email") return send(404, { error: { message: "Not found" } });
      if (request.headers.authorization !== `Zoho-enczapikey ${state.token}`) return send(401, { error: { code: "TM_3601", message: "Invalid API Token found" } });
      const input = JSON.parse(body || "{}");
      if (!input.from || !input.to) return send(400, { error: { code: "TM_3201", message: "Mandatory Field 'from' was set as Empty Value." } });
      if (state.failNext > 0) {
        state.failNext -= 1;
        return send(500, { error: { code: "TM_5000", message: "Temporary failure" } });
      }
      state.sent.push(input);
      return send(201, { data: [{ code: "EM_104", message: "Email request received" }], request_id: `zepto-${state.sent.length}` });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Plain-text SMTP server with AUTH PLAIN/LOGIN. Messages are kept raw. */
export async function startFakeSmtp(user, pass) {
  const state = { messages: [], logins: [] };
  const server = createTcpServer((socket) => {
    let buffer = "";
    let data = null;
    let message = null;
    let loginStep = null;
    let loginUser = null;
    const reply = (line) => socket.write(`${line}\r\n`);
    const authenticate = (name, password) => {
      state.logins.push(name);
      reply(name === user && password === pass ? "235 2.7.0 Authentication successful" : "535 5.7.8 Authentication credentials invalid");
    };
    reply("220 fake-smtp ready");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data !== null) {
          if (line === ".") {
            state.messages.push({ ...message, raw: data });
            data = null;
            reply("250 2.0.0 Ok: queued as FAKE1");
          } else data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          continue;
        }
        if (loginStep === "user") {
          loginUser = Buffer.from(line, "base64").toString();
          loginStep = "pass";
          reply("334 UGFzc3dvcmQ6");
          continue;
        }
        if (loginStep === "pass") {
          loginStep = null;
          authenticate(loginUser, Buffer.from(line, "base64").toString());
          continue;
        }
        const [command, ...rest] = line.split(" ");
        const verb = command.toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250-fake-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (verb === "AUTH" && rest[0]?.toUpperCase() === "PLAIN") {
          const [, name, password] = Buffer.from(rest[1] ?? "", "base64").toString().split("\0");
          authenticate(name, password);
        } else if (verb === "AUTH" && rest[0]?.toUpperCase() === "LOGIN") {
          loginStep = "user";
          reply("334 VXNlcm5hbWU6");
        } else if (verb === "MAIL") {
          message = { from: line, to: [] };
          reply("250 2.1.0 Ok");
        } else if (verb === "RCPT") {
          message.to.push(line);
          reply("250 2.1.5 Ok");
        } else if (verb === "DATA") {
          data = "";
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "RSET" || verb === "NOOP") reply("250 Ok");
        else if (verb === "QUIT") {
          reply("221 Bye");
          socket.end();
        } else reply("502 5.5.2 Command not recognised");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { state, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}
