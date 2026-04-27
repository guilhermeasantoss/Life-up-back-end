require("dotenv").config();

const express      = require("express");
const mysql        = require("mysql2");
const cors         = require("cors");
const helmet       = require("helmet");
const morgan       = require("morgan");
const https        = require("https");
const fs           = require("fs");
const path         = require("path");
const nodemailer   = require("nodemailer");
const session      = require("express-session");
const jwt          = require("jsonwebtoken");


const app = express();

// =========================
// CONFIGURAÇÃO DE EMAIL
// =========================
// Configure com seu email e senha de app (Gmail recomendado)
// Para Gmail: ative "Senhas de app" em myaccount.google.com/security
const EMAIL_CONFIG = {
  host:   process.env.EMAIL_HOST   || "smtp.gmail.com",
  port:   parseInt(process.env.EMAIL_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER || "lifeupsuplementos@gmail.com",
    pass: process.env.EMAIL_PASS || ""   // Senha de app do Gmail
  }
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG);

async function enviarEmail({ para, assunto, html }) {
  if (!EMAIL_CONFIG.auth.pass) {
    console.log(`[EMAIL SIMULADO] Para: ${para} | Assunto: ${assunto}`);
    return { ok: true, simulado: true };
  }
  try {
    await transporter.sendMail({
      from: `"LifeUp Suplementos" <${EMAIL_CONFIG.auth.user}>`,
      to:   para,
      subject: assunto,
      html
    });
    return { ok: true };
  } catch (e) {
    console.error("Erro ao enviar email:", e.message);
    return { ok: false, error: e.message };
  }
}

// --- MIDDLEWARES ---
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "lifeup_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 5 * 60 * 1000 } // 5 min para o fluxo OAuth
}));

// --- BANCO ---
const con = mysql.createPool({
  host: "127.0.0.1",
  user: "root",
  password: "",
  database: "lifeup",
  waitForConnections: true,
  connectionLimit: 10
});

con.getConnection((err, connection) => {
  if (err) {
    console.error("Erro no banco:", err.message);
  } else {
    console.log("Conectado ao banco LifeUP!");
    // Adiciona coluna apple_id se ainda não existir
    connection.query(
      "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS apple_id VARCHAR(100) NULL UNIQUE",
      (e) => { if (e && !e.message.includes("Duplicate")) console.error("apple_id:", e.message); }
    );
    connection.release();
  }
});

// =========================
// PRODUTOS
// =========================

app.get("/listar/produtos", (req, res) => {
  con.query("SELECT * FROM produtos", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// Rota especifica ANTES da rota com :id para evitar conflito
app.get("/listar/produtos/categoria/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  con.query("SELECT * FROM produtos WHERE id_categoria = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

app.get("/listar/produtos/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  con.query("SELECT * FROM produtos WHERE id_produtos = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.length === 0) return res.status(404).json({ error: "Produto nao encontrado" });
    res.json(result[0]);
  });
});

app.post("/criar/produtos", (req, res) => {
  const { nome_produto, descricao_produto, preco, marca, estoque, id_categoria, id_fornecedor } = req.body;
  if (!nome_produto || !descricao_produto || preco == null || estoque == null) {
    return res.status(400).json({ error: "Dados obrigatorios faltando" });
  }
  const sql = `INSERT INTO produtos (nome_produto, descricao_produto, preco, marca, estoque, id_categoria, id_fornecedor)
               VALUES (?, ?, ?, ?, ?, ?, ?)`;
  con.query(sql, [nome_produto, descricao_produto, preco, marca, estoque, id_categoria, id_fornecedor], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: result.insertId });
  });
});

app.put("/atualizar/produtos/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  const { nome_produto, descricao_produto, preco, marca, estoque } = req.body;
  const sql = `UPDATE produtos SET nome_produto=?, descricao_produto=?, preco=?, marca=?, estoque=? WHERE id_produtos=?`;
  con.query(sql, [nome_produto, descricao_produto, preco, marca, estoque, id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: "Produto nao encontrado" });
    res.json({ msg: "Atualizado com sucesso" });
  });
});

app.delete("/deletar/produtos/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  con.query("DELETE FROM produtos WHERE id_produtos = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: "Produto nao encontrado" });
    res.json({ msg: "Deletado com sucesso" });
  });
});

// =========================
// CATEGORIAS
// =========================

app.get("/listar/categorias", (req, res) => {
  con.query("SELECT * FROM categorias", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// =========================
// CLIENTES
// =========================

app.get("/listar/clientes", (req, res) => {
  con.query("SELECT id_clientes, nome, email, cpf, telefone, endereco, data_nascimento FROM clientes", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

app.post("/criar/clientes", (req, res) => {
  const { nome, email, cpf, senha, data_nascimento, telefone = "", endereco = "" } = req.body;
  if (!nome || !email || !cpf || !senha || !data_nascimento) {
    return res.status(400).json({ error: "Nome, email, CPF, senha e data de nascimento sao obrigatorios" });
  }
  const sql = `INSERT INTO clientes (nome, endereco, cpf, telefone, data_nascimento, email, senha)
               VALUES (?, ?, ?, ?, ?, ?, ?)`;
  con.query(sql, [nome, endereco, cpf, telefone, data_nascimento, email, senha], (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "CPF ou email ja cadastrado" });
      return res.status(500).json({ error: err.message });
    }

    // Envia email de boas-vindas
    enviarEmail({
      para: email,
      assunto: "Bem-vindo a LifeUp Suplementos!",
      html: `
        <div style="font-family:'Poppins',Arial,sans-serif;background:#0f0f0f;padding:40px 20px;max-width:600px;margin:0 auto">
          <div style="background:#1a1a1a;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a">
            <div style="background:linear-gradient(135deg,#1a0000,#2a0000);padding:32px;text-align:center;border-bottom:2px solid #e50914">
              <h1 style="color:#e50914;margin:0;font-size:2rem">⚡ LifeUp</h1>
              <p style="color:#aaa;margin:8px 0 0;font-size:0.9rem">Suplementos</p>
            </div>
            <div style="padding:32px">
              <h2 style="color:#fff;margin:0 0 12px">Olá, ${nome}! 👋</h2>
              <p style="color:#aaa;line-height:1.7;margin:0 0 20px">
                Seu cadastro na <strong style="color:#e50914">LifeUp Suplementos</strong> foi realizado com sucesso!
                Agora você tem acesso a todos os nossos produtos de alta qualidade.
              </p>
              <div style="background:#111;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #2a2a2a">
                <p style="color:#888;font-size:0.8rem;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px">Email cadastrado</p>
                <p style="color:#fff;margin:0;font-size:0.95rem">${email}</p>
              </div>
              <a href="http://127.0.0.1:5501/projeto/loja.html"
                style="display:inline-block;background:#e50914;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem">
                Ver Produtos
              </a>
            </div>
            <div style="padding:20px 32px;border-top:1px solid #2a2a2a;text-align:center">
              <p style="color:#444;font-size:0.78rem;margin:0">© 2025 LifeUp Suplementos · support@lifeup.com</p>
            </div>
          </div>
        </div>`
    });

    res.status(201).json({ id: result.insertId, msg: "Cadastro realizado com sucesso" });
  });
});

app.post("/login/clientes", (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: "Email e senha sao obrigatorios" });
  const sql = "SELECT id_clientes, nome, email FROM clientes WHERE email = ? AND senha = ?";
  con.query(sql, [email, senha], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.length === 0) return res.status(401).json({ error: "Email ou senha invalidos" });
    res.json({ ...result[0], msg: "Login realizado com sucesso" });
  });
});

// Atualizar dados do cliente (nome, email, telefone, endereco, data_nascimento)
app.put("/atualizar/clientes/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });

  const { nome, email, data_nascimento, telefone = "", endereco = "" } = req.body;
  if (!nome || !email) return res.status(400).json({ error: "Nome e email sao obrigatorios" });

  const sql = `UPDATE clientes SET nome=?, email=?, data_nascimento=?, telefone=?, endereco=?
               WHERE id_clientes=?`;
  con.query(sql, [nome, email, data_nascimento || null, telefone, endereco, id], (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "Email ja cadastrado por outro usuario" });
      return res.status(500).json({ error: err.message });
    }
    if (result.affectedRows === 0) return res.status(404).json({ error: "Cliente nao encontrado" });
    res.json({ msg: "Dados atualizados com sucesso" });
  });
});

// =========================
// PEDIDOS
// =========================

app.post("/criar/pedidos", (req, res) => {
  const { id_clientes, itens, valor_total } = req.body;
  if (!id_clientes || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: "Pedido invalido" });
  }
  const sqlPedido = "INSERT INTO pedidos (id_clientes, valor_total) VALUES (?, ?)";
  con.query(sqlPedido, [id_clientes, valor_total], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    const idPedido = result.insertId;
    itens.forEach(item => {
      con.query(
        "INSERT INTO itens_pedido (id_pedidos, id_produtos, quantidade, preco_unitario) VALUES (?,?,?,?)",
        [idPedido, item.id_produtos, item.quantidade, item.preco_unitario]
      );
      con.query(
        "UPDATE produtos SET estoque = estoque - ? WHERE id_produtos = ? AND estoque >= ?",
        [item.quantidade, item.id_produtos, item.quantidade]
      );
    });

    // Busca email do cliente para enviar confirmação
    con.query(
      "SELECT nome, email FROM clientes WHERE id_clientes = ?",
      [id_clientes],
      (err2, rows) => {
        if (!err2 && rows.length > 0) {
          const { nome, email } = rows[0];
          const itensHTML = itens.map(i =>
            `<tr>
              <td style="padding:10px 14px;color:#ccc;border-bottom:1px solid #222">${i.nome_produto || 'Produto #' + i.id_produtos}</td>
              <td style="padding:10px 14px;color:#ccc;border-bottom:1px solid #222;text-align:center">${i.quantidade}</td>
              <td style="padding:10px 14px;color:#e50914;border-bottom:1px solid #222;text-align:right;font-weight:600">
                R$ ${(i.preco_unitario * i.quantidade).toFixed(2).replace('.',',')}
              </td>
            </tr>`
          ).join('');

          enviarEmail({
            para: email,
            assunto: `Pedido #${idPedido} confirmado — LifeUp Suplementos`,
            html: `
              <div style="font-family:'Poppins',Arial,sans-serif;background:#0f0f0f;padding:40px 20px;max-width:600px;margin:0 auto">
                <div style="background:#1a1a1a;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a">
                  <div style="background:linear-gradient(135deg,#1a0000,#2a0000);padding:32px;text-align:center;border-bottom:2px solid #e50914">
                    <h1 style="color:#e50914;margin:0;font-size:2rem">⚡ LifeUp</h1>
                    <p style="color:#aaa;margin:8px 0 0;font-size:0.9rem">Confirmação de Pedido</p>
                  </div>
                  <div style="padding:32px">
                    <h2 style="color:#fff;margin:0 0 6px">Pedido confirmado! 🎉</h2>
                    <p style="color:#aaa;margin:0 0 24px">Olá, <strong style="color:#fff">${nome}</strong>! Seu pedido foi recebido com sucesso.</p>

                    <div style="background:#111;border-radius:10px;padding:16px 20px;margin-bottom:20px;border:1px solid #2a2a2a">
                      <p style="color:#888;font-size:0.78rem;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px">Número do Pedido</p>
                      <p style="color:#e50914;font-size:1.2rem;font-weight:700;margin:0">#${idPedido}</p>
                    </div>

                    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
                      <thead>
                        <tr style="background:#111">
                          <th style="padding:10px 14px;color:#666;font-size:0.78rem;text-align:left;text-transform:uppercase;letter-spacing:0.5px">Produto</th>
                          <th style="padding:10px 14px;color:#666;font-size:0.78rem;text-align:center;text-transform:uppercase;letter-spacing:0.5px">Qtd</th>
                          <th style="padding:10px 14px;color:#666;font-size:0.78rem;text-align:right;text-transform:uppercase;letter-spacing:0.5px">Total</th>
                        </tr>
                      </thead>
                      <tbody>${itensHTML}</tbody>
                      <tfoot>
                        <tr>
                          <td colspan="2" style="padding:14px;color:#fff;font-weight:700;font-size:1rem">Total</td>
                          <td style="padding:14px;color:#e50914;font-weight:700;font-size:1.1rem;text-align:right">
                            R$ ${parseFloat(valor_total).toFixed(2).replace('.',',')}
                          </td>
                        </tr>
                      </tfoot>
                    </table>

                    <p style="color:#666;font-size:0.82rem;line-height:1.6;margin:0">
                      Em caso de dúvidas, entre em contato: <a href="mailto:support@lifeup.com" style="color:#e50914">support@lifeup.com</a>
                    </p>
                  </div>
                  <div style="padding:20px 32px;border-top:1px solid #2a2a2a;text-align:center">
                    <p style="color:#444;font-size:0.78rem;margin:0">© 2025 LifeUp Suplementos</p>
                  </div>
                </div>
              </div>`
          });
        }
      }
    );

    res.status(201).json({ msg: "Pedido criado com sucesso", id_pedidos: idPedido });
  });
});

app.get("/listar/pedidos/cliente/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  const sql = `
    SELECT p.*, ip.id_produtos, ip.quantidade, ip.preco_unitario, pr.nome_produto
    FROM pedidos p
    LEFT JOIN itens_pedido ip ON p.id_pedidos = ip.id_pedidos
    LEFT JOIN produtos pr ON ip.id_produtos = pr.id_produtos
    WHERE p.id_clientes = ?
    ORDER BY p.id_pedidos DESC
  `;
  con.query(sql, [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// =========================
// AVALIACOES
// =========================

app.post("/criar/avaliacoes", (req, res) => {
  const { id_produtos, id_clientes, nota, comentario } = req.body;
  if (!id_produtos || !id_clientes || !nota) return res.status(400).json({ error: "Dados obrigatorios faltando" });
  if (nota < 1 || nota > 5) return res.status(400).json({ error: "Nota deve ser entre 1 e 5" });
  const sql = "INSERT INTO avaliacoes (id_produtos, id_clientes, nota, comentario) VALUES (?, ?, ?, ?)";
  con.query(sql, [id_produtos, id_clientes, nota, comentario], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: result.insertId });
  });
});

app.get("/listar/avaliacoes/produto/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  con.query("SELECT * FROM avaliacoes WHERE id_produtos = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

app.get("/listar/avaliacoes", (req, res) => {
  con.query("SELECT * FROM avaliacoes", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// =========================
// SENHA — Alterar e Recuperar
// =========================

// Alterar senha (usuario logado — exige senha atual)
app.put("/alterar/senha", (req, res) => {
  const { email, senha_atual, senha_nova } = req.body;
  if (!email || !senha_atual || !senha_nova)
    return res.status(400).json({ error: "Dados obrigatorios faltando" });
  if (senha_nova.length < 6)
    return res.status(400).json({ error: "Nova senha deve ter no minimo 6 caracteres" });

  // Verifica senha atual
  con.query(
    "SELECT id_clientes FROM clientes WHERE email = ? AND senha = ?",
    [email, senha_atual],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.length === 0) return res.status(401).json({ error: "Senha atual incorreta" });

      con.query(
        "UPDATE clientes SET senha = ? WHERE email = ?",
        [senha_nova, email],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ msg: "Senha alterada com sucesso" });
        }
      );
    }
  );
});

// Verificar identidade para recuperacao de senha (email + CPF)
app.post("/verificar/identidade", (req, res) => {
  const { email, cpf } = req.body;
  if (!email || !cpf) return res.status(400).json({ error: "Email e CPF obrigatorios" });

  con.query(
    "SELECT id_clientes FROM clientes WHERE email = ? AND cpf = ?",
    [email, cpf],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.length === 0) return res.status(404).json({ error: "Email ou CPF nao encontrado" });
      res.json({ ok: true });
    }
  );
});

// Recuperar senha (sem login — valida email + CPF)
app.put("/recuperar/senha", (req, res) => {
  const { email, cpf, senha_nova } = req.body;
  if (!email || !cpf || !senha_nova)
    return res.status(400).json({ error: "Dados obrigatorios faltando" });
  if (senha_nova.length < 6)
    return res.status(400).json({ error: "Nova senha deve ter no minimo 6 caracteres" });

  con.query(
    "UPDATE clientes SET senha = ? WHERE email = ? AND cpf = ?",
    [senha_nova, email, cpf],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ error: "Dados nao encontrados" });
      res.json({ msg: "Senha redefinida com sucesso" });
    }
  );
});

// =========================
// PIX — Banco Inter
// =========================

// Cria tabela de pagamentos_pix se nao existir
con.query(`
  CREATE TABLE IF NOT EXISTS pagamentos_pix (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    txid      VARCHAR(50)    NOT NULL UNIQUE,
    valor     DECIMAL(10,2)  NOT NULL,
    status    ENUM('pendente','pago','expirado') DEFAULT 'pendente',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pago_em   TIMESTAMP NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`, (err) => {
  if (err) console.error("Erro ao criar tabela pagamentos_pix:", err.message);
  else console.log("Tabela pagamentos_pix pronta.");
});

// Configuracao Banco Inter
// Credenciais geradas em: Inter > Internet Banking > Solucoes para sua empresa > Nova Integracao
// Arquivos: inter_cert.crt e inter_key.key (baixar no IB apos criar integracao)
const INTER = {
  client_id:     process.env.INTER_CLIENT_ID     || "",
  client_secret: process.env.INTER_CLIENT_SECRET || "",
  conta:         process.env.INTER_CONTA         || "",
  cert:          path.join(__dirname, "inter_cert.crt"),
  key:           path.join(__dirname, "inter_key.key"),
  url:           "https://cdpj.partners.bancointer.com.br"
};

let _interToken  = null;
let _interExpiry = 0;

async function tokenInter() {
  if (_interToken && Date.now() < _interExpiry) return _interToken;
  if (!INTER.client_id) throw new Error("INTER_CLIENT_ID nao configurado");
  if (!fs.existsSync(INTER.cert))  throw new Error("inter_cert.crt nao encontrado em " + INTER.cert);
  if (!fs.existsSync(INTER.key))   throw new Error("inter_key.key nao encontrado em " + INTER.key);

  const agent = new https.Agent({ cert: fs.readFileSync(INTER.cert), key: fs.readFileSync(INTER.key) });
  const body  = `client_id=${encodeURIComponent(INTER.client_id)}&client_secret=${encodeURIComponent(INTER.client_secret)}&scope=extrato.read+cob.read+pix.read&grant_type=client_credentials`;

  const resp = await fetch(`${INTER.url}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    // @ts-ignore
    agent
  });
  if (!resp.ok) throw new Error("Token Inter: " + resp.status);
  const data   = await resp.json();
  _interToken  = data.access_token;
  _interExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _interToken;
}

async function pixRecebidosInter(valor) {
  const token = await tokenInter();
  const agent = new https.Agent({ cert: fs.readFileSync(INTER.cert), key: fs.readFileSync(INTER.key) });
  const agora  = new Date();
  const inicio = new Date(agora.getTime() - 10 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const fim    = agora.toISOString().replace(/\.\d+Z$/, "Z");

  const resp = await fetch(`${INTER.url}/pix/v2/pix?inicio=${inicio}&fim=${fim}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(INTER.conta ? { "x-conta-corrente": INTER.conta } : {})
    },
    // @ts-ignore
    agent
  });
  if (!resp.ok) throw new Error("Consulta Pix Inter: " + resp.status);
  const data = await resp.json();
  return (data.pix || []).some(p => Math.abs(parseFloat(p.valor) - valor) < 0.01);
}

// Registra pagamento pendente ao exibir o QR code
app.post("/pix/registrar", (req, res) => {
  const { txid, valor } = req.body;
  if (!txid || !valor) return res.status(400).json({ error: "txid e valor obrigatorios" });

  con.query("DELETE FROM pagamentos_pix WHERE valor = ? AND status = 'pendente' AND criado_em < DATE_SUB(NOW(), INTERVAL 10 MINUTE)", [valor]);
  con.query(
    "INSERT INTO pagamentos_pix (txid, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE status='pendente', criado_em=NOW()",
    [txid, valor],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, txid });
    }
  );
});

// Polling do frontend — verifica se o pagamento foi confirmado
app.get("/verificar/pix", async (req, res) => {
  const valor = parseFloat(req.query.valor);
  const txid  = req.query.txid || null;
  if (isNaN(valor)) return res.status(400).json({ error: "Valor invalido" });

  // Tenta API do Inter se credenciais e certificados estiverem presentes
  if (INTER.client_id && fs.existsSync(INTER.cert) && fs.existsSync(INTER.key)) {
    try {
      const pago = await pixRecebidosInter(valor);
      if (pago) {
        con.query(
          "UPDATE pagamentos_pix SET status='pago', pago_em=NOW() WHERE ABS(valor - ?) < 0.01 AND status='pendente'",
          [valor]
        );
        return res.json({ pago: true });
      }
      return res.json({ pago: false });
    } catch (e) {
      console.error("Erro API Inter:", e.message);
      // Cai no fallback local
    }
  }

  // Fallback: verifica na tabela local (confirmado via webhook ou /pix/confirmar-teste)
  const sql    = txid
    ? "SELECT status FROM pagamentos_pix WHERE txid = ? LIMIT 1"
    : "SELECT status FROM pagamentos_pix WHERE ABS(valor - ?) < 0.01 AND criado_em >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) ORDER BY criado_em DESC LIMIT 1";
  const params = [txid || valor];

  con.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ pago: result.length > 0 && result[0].status === "pago" });
  });
});

// Webhook do Inter — confirma automaticamente quando Pix e recebido
// Registrar no portal Inter: POST https://seusite.com/webhook/pix
app.post("/webhook/pix", (req, res) => {
  const pixList = req.body.pix || (req.body.txid ? [req.body] : []);
  pixList.forEach(p => {
    const valor = parseFloat(p.valor);
    const txid  = p.txid || null;
    console.log(`Webhook Pix Inter: R$ ${valor} | txid: ${txid}`);
    if (txid) {
      con.query("UPDATE pagamentos_pix SET status='pago', pago_em=NOW() WHERE txid = ?", [txid]);
    } else {
      con.query(
        "UPDATE pagamentos_pix SET status='pago', pago_em=NOW() WHERE ABS(valor - ?) < 0.01 AND status='pendente' AND criado_em >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) ORDER BY criado_em DESC LIMIT 1",
        [valor]
      );
    }
  });
  res.status(200).json({ ok: true });
});

// Confirmacao manual de teste — usar enquanto nao tiver credenciais Inter
// Exemplo: POST /pix/confirmar-teste { "valor": "9.90" }
app.post("/pix/confirmar-teste", (req, res) => {
  const { valor } = req.body;
  if (!valor) return res.status(400).json({ error: "valor obrigatorio" });
  con.query(
    "UPDATE pagamentos_pix SET status='pago', pago_em=NOW() WHERE ABS(valor - ?) < 0.01 AND status='pendente' ORDER BY criado_em DESC LIMIT 1",
    [parseFloat(valor)],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, atualizados: result.affectedRows });
    }
  );
});



// =========================
// SERVER
// =========================
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

