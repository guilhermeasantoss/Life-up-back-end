require("dotenv").config();
const express    = require("express");
const mysql      = require("mysql2");
const cors       = require("cors");
const helmet     = require("helmet");
const morgan     = require("morgan");
const https      = require("https");
const fs         = require("fs");
const path       = require("path");
const nodemailer = require("nodemailer");
const session    = require("express-session");

const app = express();

console.log("DB_HOST:", process.env.DB_HOST);
console.log("MYSQL_URL:", process.env.MYSQL_URL ? "definido" : "indefinido");

const EMAIL_CONFIG = {
  host:   process.env.EMAIL_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.EMAIL_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER || "lifeupsuplementos@gmail.com",
    pass: process.env.EMAIL_PASS || ""
  }
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG);

async function enviarEmail({ para, assunto, html }) {
  if (!EMAIL_CONFIG.auth.pass) {
    console.log(`[EMAIL SIMULADO] Para: ${para}`);
    return { ok: true };
  }
  try {
    await transporter.sendMail({
      from: `"LifeUp Suplementos" <${EMAIL_CONFIG.auth.user}>`,
      to: para,
      subject: assunto,
      html
    });
    return { ok: true };
  } catch (e) {
    console.error("Erro email:", e.message);
    return { ok: false };
  }
}

app.use(helmet());
app.use(cors({
  origin: ["https://lifeup-suplementos.vercel.app", "https://life-up-chi.vercel.app"],
  credentials: true
}));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "lifeup_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 5 * 60 * 1000 }
}));

function parseMySQL(url) {
  const u = new URL(url);
  return {
    host:     u.hostname,
    port:     parseInt(u.port) || 3306,
    user:     u.username,
    password: u.password,
    database: u.pathname.replace("/", ""),
    waitForConnections: true,
    connectionLimit: 10
  };
}

const con = process.env.MYSQL_URL
  ? mysql.createPool(parseMySQL(process.env.MYSQL_URL))
  : mysql.createPool({
      host:     process.env.DB_HOST     || "127.0.0.1",
      user:     process.env.DB_USER     || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME     || "lifeup",
      waitForConnections: true,
      connectionLimit: 10
    });

con.getConnection((err, connection) => {
  if (err) { console.error("Erro no banco:", err.message); return; }
  console.log("Conectado ao banco LifeUP!");

  connection.query(
    "ALTER TABLE clientes ADD COLUMN apple_id VARCHAR(100) NULL UNIQUE",
    (e) => {
      if (e && !e.message.includes("Duplicate")) console.error("apple_id:", e.message);
    }
  );

  connection.query(`
    CREATE TABLE IF NOT EXISTS pagamentos_pix (
      id INT AUTO_INCREMENT PRIMARY KEY,
      txid VARCHAR(50) NOT NULL UNIQUE,
      valor DECIMAL(10,2) NOT NULL,
      status ENUM('pendente','pago','expirado') DEFAULT 'pendente',
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      pago_em TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, (e) => {
    if (e) console.error("Erro ao criar tabela pagamentos_pix:", e.message);
    else console.log("Tabela pagamentos_pix pronta.");
  });

  connection.release();
});

// ── Produtos ──────────────────────────────────────────────────────────────────

app.get("/listar/produtos", (req, res) => {
  con.query("SELECT * FROM produtos", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

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
  if (!nome_produto || !descricao_produto || preco == null || estoque == null)
    return res.status(400).json({ error: "Dados obrigatorios faltando" });
  con.query(
    "INSERT INTO produtos (nome_produto, descricao_produto, preco, marca, estoque, id_categoria, id_fornecedor) VALUES (?,?,?,?,?,?,?)",
    [nome_produto, descricao_produto, preco, marca, estoque, id_categoria, id_fornecedor],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: result.insertId });
    }
  );
});

app.put("/atualizar/produtos/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  const { nome_produto, descricao_produto, preco, marca, estoque } = req.body;
  con.query(
    "UPDATE produtos SET nome_produto=?, descricao_produto=?, preco=?, marca=?, estoque=? WHERE id_produtos=?",
    [nome_produto, descricao_produto, preco, marca, estoque, id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ error: "Produto nao encontrado" });
      res.json({ msg: "Atualizado com sucesso" });
    }
  );
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

// ── Categorias ────────────────────────────────────────────────────────────────

app.get("/listar/categorias", (req, res) => {
  con.query("SELECT * FROM categorias", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// ── Clientes ──────────────────────────────────────────────────────────────────

app.get("/listar/clientes", (req, res) => {
  con.query(
    "SELECT id_clientes, nome, email, cpf, telefone, endereco, data_nascimento FROM clientes",
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(result);
    }
  );
});

app.post("/criar/clientes", (req, res) => {
  const { nome, email, cpf, senha, data_nascimento, telefone = "", endereco = "" } = req.body;
  if (!nome || !email || !cpf || !senha || !data_nascimento)
    return res.status(400).json({ error: "Nome, email, CPF, senha e data de nascimento sao obrigatorios" });
  con.query(
    "INSERT INTO clientes (nome, endereco, cpf, telefone, data_nascimento, email, senha) VALUES (?,?,?,?,?,?,?)",
    [nome, endereco, cpf, telefone, data_nascimento, email, senha],
    (err, result) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "CPF ou email ja cadastrado" });
        return res.status(500).json({ error: err.message });
      }
      enviarEmail({
        para: email,
        assunto: "Bem-vindo a LifeUp Suplementos!",
        html: `<h1>Bem-vindo, ${nome}!</h1><p>Seu cadastro foi realizado com sucesso.</p>`
      });
      res.status(201).json({ id: result.insertId, msg: "Cadastro realizado com sucesso" });
    }
  );
});

app.post("/login/clientes", (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: "Email e senha sao obrigatorios" });
  con.query(
    "SELECT id_clientes, nome, email FROM clientes WHERE email = ? AND senha = ?",
    [email, senha],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.length === 0) return res.status(401).json({ error: "Email ou senha invalidos" });
      res.json({ ...result[0], msg: "Login realizado com sucesso" });
    }
  );
});

app.put("/atualizar/clientes/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  const { nome, email, data_nascimento, telefone = "", endereco = "" } = req.body;
  if (!nome || !email) return res.status(400).json({ error: "Nome e email sao obrigatorios" });
  con.query(
    "UPDATE clientes SET nome=?, email=?, data_nascimento=?, telefone=?, endereco=? WHERE id_clientes=?",
    [nome, email, data_nascimento || null, telefone, endereco, id],
    (err, result) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "Email ja cadastrado por outro usuario" });
        return res.status(500).json({ error: err.message });
      }
      if (result.affectedRows === 0) return res.status(404).json({ error: "Cliente nao encontrado" });
      res.json({ msg: "Dados atualizados com sucesso" });
    }
  );
});

// ── Pedidos ───────────────────────────────────────────────────────────────────

app.post("/criar/pedidos", (req, res) => {
  const { id_clientes, itens, valor_total } = req.body;
  if (!id_clientes || !Array.isArray(itens) || itens.length === 0)
    return res.status(400).json({ error: "Pedido invalido" });
  con.query(
    "INSERT INTO pedidos (id_clientes, valor_total) VALUES (?,?)",
    [id_clientes, valor_total],
    (err, result) => {
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
      res.status(201).json({ msg: "Pedido criado com sucesso", id_pedidos: idPedido });
    }
  );
});

app.get("/listar/pedidos/cliente/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalido" });
  con.query(`
    SELECT p.*, ip.id_produtos, ip.quantidade, ip.preco_unitario, pr.nome_produto
    FROM pedidos p
    LEFT JOIN itens_pedido ip ON p.id_pedidos = ip.id_pedidos
    LEFT JOIN produtos pr ON ip.id_produtos = pr.id_produtos
    WHERE p.id_clientes = ?
    ORDER BY p.id_pedidos DESC
  `, [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// ── Avaliações ────────────────────────────────────────────────────────────────

app.post("/criar/avaliacoes", (req, res) => {
  const { id_produtos, id_clientes, nota, comentario } = req.body;
  if (!id_produtos || !id_clientes || !nota)
    return res.status(400).json({ error: "Dados obrigatorios faltando" });
  if (nota < 1 || nota > 5)
    return res.status(400).json({ error: "Nota deve ser entre 1 e 5" });
  con.query(
    "INSERT INTO avaliacoes (id_produtos, id_clientes, nota, comentario) VALUES (?,?,?,?)",
    [id_produtos, id_clientes, nota, comentario],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: result.insertId });
    }
  );
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

// ── Senha ─────────────────────────────────────────────────────────────────────

app.put("/alterar/senha", (req, res) => {
  const { email, senha_atual, senha_nova } = req.body;
  if (!email || !senha_atual || !senha_nova)
    return res.status(400).json({ error: "Dados obrigatorios faltando" });
  if (senha_nova.length < 6)
    return res.status(400).json({ error: "Nova senha deve ter no minimo 6 caracteres" });
  con.query(
    "SELECT id_clientes FROM clientes WHERE email = ? AND senha = ?",
    [email, senha_atual],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.length === 0) return res.status(401).json({ error: "Senha atual incorreta" });
      con.query("UPDATE clientes SET senha = ? WHERE email = ?", [senha_nova, email], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ msg: "Senha alterada com sucesso" });
      });
    }
  );
});

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

// ── PIX ───────────────────────────────────────────────────────────────────────

const INTER = {
  client_id:     process.env.INTER_CLIENT_ID     || "",
  client_secret: process.env.INTER_CLIENT_SECRET || "",
  conta:         process.env.INTER_CONTA         || "",
  cert:          path.join(__dirname, "inter_cert.crt"),
  key:           path.join(__dirname, "inter_key.key"),
  url:           "https://cdpj.partners.bancointer.com.br"
};

let _interToken = null, _interExpiry = 0;

async function tokenInter() {
  if (_interToken && Date.now() < _interExpiry) return _interToken;
  if (!INTER.client_id) throw new Error("INTER_CLIENT_ID nao configurado");
  if (!fs.existsSync(INTER.cert)) throw new Error("inter_cert.crt nao encontrado");
  if (!fs.existsSync(INTER.key))  throw new Error("inter_key.key nao encontrado");
  const agent = new https.Agent({ cert: fs.readFileSync(INTER.cert), key: fs.readFileSync(INTER.key) });
  const body  = `client_id=${encodeURIComponent(INTER.client_id)}&client_secret=${encodeURIComponent(INTER.client_secret)}&scope=extrato.read+cob.read+pix.read&grant_type=client_credentials`;
  const resp  = await fetch(`${INTER.url}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    agent
  });
  if (!resp.ok) throw new Error("Token Inter: " + resp.status);
  const data = await resp.json();
  _interToken  = data.access_token;
  _interExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _interToken;
}

app.post("/pix/registrar", (req, res) => {
  const { txid, valor } = req.body;
  if (!txid || !valor) return res.status(400).json({ error: "txid e valor obrigatorios" });
  con.query(
    "DELETE FROM pagamentos_pix WHERE valor = ? AND status = 'pendente' AND criado_em < DATE_SUB(NOW(), INTERVAL 10 MINUTE)",
    [valor]
  );
  con.query(
    "INSERT INTO pagamentos_pix (txid, valor) VALUES (?,?) ON DUPLICATE KEY UPDATE status='pendente', criado_em=NOW()",
    [txid, valor],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, txid });
    }
  );
});

app.get("/verificar/pix", (req, res) => {
  const valor = parseFloat(req.query.valor);
  const txid  = req.query.txid || null;
  if (isNaN(valor)) return res.status(400).json({ error: "Valor invalido" });
  const sql = txid
    ? "SELECT status FROM pagamentos_pix WHERE txid = ? LIMIT 1"
    : "SELECT status FROM pagamentos_pix WHERE ABS(valor - ?) < 0.01 AND criado_em >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) ORDER BY criado_em DESC LIMIT 1";
  con.query(sql, [txid || valor], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ pago: result.length > 0 && result[0].status === "pago" });
  });
});

app.post("/webhook/pix", (req, res) => {
  const pixList = req.body.pix || (req.body.txid ? [req.body] : []);
  pixList.forEach(p => {
    if (p.txid) {
      con.query("UPDATE pagamentos_pix SET status='pago', pago_em=NOW() WHERE txid = ?", [p.txid]);
    } else {
      con.query(
        "UPDATE pagamentos_pix SET status='pago', pago_em=NOW() WHERE ABS(valor - ?) < 0.01 AND status='pendente' ORDER BY criado_em DESC LIMIT 1",
        [parseFloat(p.valor)]
      );
    }
  });
  res.status(200).json({ ok: true });
});

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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });
