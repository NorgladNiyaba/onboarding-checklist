// server.js
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// ====== DATABASE SETUP (Supabase Postgres via DATABASE_URL) ======

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase Postgres expects SSL; this keeps it happy on Render.
  ssl:
    process.env.DATABASE_SSL === "false"
      ? false
      : { rejectUnauthorized: false }
});

// Create tables if they don't exist
async function initDb() {
  // Table: clients (id + name)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

  // Table: client_states (one JSON state per client)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_states (
      client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      state     JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  console.log("Database initialized");
}

function makeClientId(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "client"
  );
}

// ====== API ROUTES ======

// List all clients
app.get("/api/clients", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name FROM clients ORDER BY name ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching clients:", err);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// Create a client (or update its name if id already exists)
app.post("/api/clients", async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }

  const id = makeClientId(name);
  const cleanName = name.trim();

  try {
    const result = await pool.query(
      `
      INSERT INTO clients (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name
      RETURNING id, name;
      `,
      [id, cleanName]
    );

    const client = result.rows[0];

    // Ensure there's at least an empty state row for this client
    await pool.query(
      `
      INSERT INTO client_states (client_id, state)
      VALUES ($1, '{}'::jsonb)
      ON CONFLICT (client_id) DO NOTHING;
      `,
      [client.id]
    );

    console.log("Created/updated client:", client.id, "-", client.name);
    res.json(client);
  } catch (err) {
    console.error("Error creating client:", err);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// Get checklist state for a specific client
app.get("/api/clients/:id/state", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query(
      "SELECT state FROM client_states WHERE client_id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      // No state saved yet → return empty object
      return res.json({});
    }

    res.json(result.rows[0].state || {});
  } catch (err) {
    console.error("Error fetching state for client:", id, err);
    res.status(500).json({ error: "Failed to fetch client state" });
  }
});

// Update checklist state for a client
app.put("/api/clients/:id/state", async (req, res) => {
  const id = req.params.id;
  const state = req.body;

  if (typeof state !== "object" || Array.isArray(state)) {
    return res.status(400).json({ error: "State must be an object" });
  }

  try {
    // Ensure client exists; if not, create it with id as name
    await pool.query(
      `
      INSERT INTO clients (id, name)
      VALUES ($1, $1)
      ON CONFLICT (id) DO NOTHING;
      `,
      [id]
    );

    // Upsert state
    await pool.query(
      `
      INSERT INTO client_states (client_id, state)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (client_id) DO UPDATE
        SET state = EXCLUDED.state;
      `,
      [id, JSON.stringify(state)]
    );

    console.log("Updated state for client:", id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error updating state for client:", id, err);
    res.status(500).json({ error: "Failed to update client state" });
  }
});

// Simple health check
app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

// ====== STATIC FRONTEND ======

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ====== START SERVER AFTER DB INIT ======

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log("Onboarding checklist server running on port", PORT);
    });
  } catch (err) {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  }
}

start();
