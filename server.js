// server.js
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// ====== DATABASE SETUP (Supabase Postgres via DATABASE_URL) ======

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is NOT set. Please set it in Render env vars.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase Postgres expects SSL in most hosted setups
  ssl:
    process.env.DATABASE_SSL === "false"
      ? false
      : { rejectUnauthorized: false }
});

// Create tables if they don't exist
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_states (
      client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      state     JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  console.log("Database initialized");
}

// Internal ID from name (used only once on creation)
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

// TEMPORARY ADMIN ROUTE: wipe all clients & states
// Visit /api/admin/reset-all once, then remove this route if you want.
app.get("/api/admin/reset-all", async (req, res) => {
  try {
    await pool.query("DELETE FROM client_states;");
    await pool.query("DELETE FROM clients;");
    res.json({ ok: true, message: "All clients and states wiped." });
  } catch (err) {
    console.error("Reset failed:", err);
    res.status(500).json({ error: "Failed to reset" });
  }
});

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

// ✅ Rename client (edit visible company name)
app.put("/api/clients/:id", async (req, res) => {
  const id = req.params.id;
  const { name } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }

  const cleanName = name.trim();

  try {
    const result = await pool.query(
      `
      UPDATE clients
      SET name = $2
      WHERE id = $1
      RETURNING id, name;
      `,
      [id, cleanName]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const client = result.rows[0];
    console.log("Renamed client:", id, "→", client.name);
    res.json(client);
  } catch (err) {
    console.error("Error renaming client:", err);
    res.status(500).json({ error: "Failed to rename client" });
  }
});

// ✅ Delete client (and its checklist state via CASCADE)
app.delete("/api/clients/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query(
      "DELETE FROM clients WHERE id = $1 RETURNING id;",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    console.log("Deleted client:", id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting client:", err);
    res.status(500).json({ error: "Failed to delete client" });
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
    await pool.query(
      `
      INSERT INTO clients (id, name)
      VALUES ($1, $1)
      ON CONFLICT (id) DO NOTHING;
      `,
      [id]
    );

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
