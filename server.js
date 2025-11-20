const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

// In-memory store: { [id]: { id, name, state: {taskId: boolean} } }
const CLIENTS = {};

function makeClientId(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "client"
  );
}

// List clients
app.get("/api/clients", (req, res) => {
  const list = Object.values(CLIENTS).map(c => ({
    id: c.id,
    name: c.name
  }));
  res.json(list);
});

// Create client (or return existing)
app.post("/api/clients", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  const id = makeClientId(name);
  if (!CLIENTS[id]) {
    CLIENTS[id] = { id, name: name.trim(), state: {} };
    console.log("Created client:", id, "-", name.trim());
  }
  res.json({ id: CLIENTS[id].id, name: CLIENTS[id].name });
});

// Get checklist state for a client
app.get("/api/clients/:id/state", (req, res) => {
  const client = CLIENTS[req.params.id];
  if (!client) {
    // If unknown client, just return empty state
    return res.json({});
  }
  res.json(client.state || {});
});

// Update checklist state for a client
app.put("/api/clients/:id/state", (req, res) => {
  const id = req.params.id;
  const state = req.body;
  if (typeof state !== "object" || Array.isArray(state)) {
    return res.status(400).json({ error: "State must be an object" });
  }
  if (!CLIENTS[id]) {
    // If the client doesn't exist yet, create a basic one
    CLIENTS[id] = { id, name: id, state: {} };
  }
  CLIENTS[id].state = state;
  console.log("Updated state for client:", id);
  res.json({ ok: true });
});

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback – send index.html for any other route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Onboarding checklist server running on port", PORT);
});
