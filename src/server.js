require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const mqtt = require("mqtt");

const { getSupabaseClient } = require("./supabase");
const { safeParseJson, normalizePunch } = require("./normalize");
const { ensureDeviceRow, insertPunches } = require("./ingest");

const PORT = parseInt(process.env.PORT || "3000", 10);
const MQTT_URL = process.env.MQTT_URL;
const MQTT_SUB_TOPIC = process.env.MQTT_SUB_TOPIC || "aiface/+/sub";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const STORE_IMAGES = String(process.env.STORE_IMAGES || "false").toLowerCase() === "true";

if (!MQTT_URL) {
  console.error("ERROR: MQTT_URL is required.");
  process.exit(1);
}
if (!ADMIN_TOKEN) {
  console.error("ERROR: ADMIN_TOKEN is required (set a long random string).");
  process.exit(1);
}

const supabase = getSupabaseClient();

// --- simple auth for admin endpoints
function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const expected = `Bearer ${ADMIN_TOKEN}`;
  if (header !== expected) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// --- MQTT ingestion
let lastIngest = { at: null, device_sn: null, inserted: 0, error: null };

async function handleIncomingMqtt(topic, payloadStr) {
  const msg = safeParseJson(payloadStr);
  if (!msg || typeof msg !== "object") return;

  // Device logs arrive as cmd:"sendlog" with record:[...]
  // (per the vendor spec) :contentReference[oaicite:1]{index=1}
  if (msg.cmd !== "sendlog" || !Array.isArray(msg.record)) return;

  const deviceSn = msg.sn || null;
  const punches = [];

  for (const rec of msg.record) {
    const p = normalizePunch(deviceSn, msg, rec);

    // Ignore enrollid 0/system events for attendance
    if (!p.enrollid || p.enrollid <= 0) continue;

    if (!STORE_IMAGES) p.image_base64 = null;
    punches.push(p);
  }

  if (!punches.length) return;

  try {
    if (deviceSn) await ensureDeviceRow(supabase, deviceSn);
    const result = await insertPunches(supabase, punches);

    lastIngest = {
      at: new Date().toISOString(),
      device_sn: deviceSn,
      inserted: result.inserted || 0,
      error: result.error || null
    };
    console.log("Ingested punches:", lastIngest);
  } catch (e) {
    lastIngest = {
      at: new Date().toISOString(),
      device_sn: deviceSn,
      inserted: 0,
      error: e?.message || String(e)
    };
    console.error("Ingest exception:", lastIngest.error);
  }
}

const mqttClient = mqtt.connect(MQTT_URL, {
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 20000
});

mqttClient.on("connect", () => {
  console.log("MQTT connected:", MQTT_URL);
  mqttClient.subscribe(MQTT_SUB_TOPIC, { qos: 1 }, (err) => {
    if (err) console.error("MQTT subscribe error:", err.message);
    else console.log("Subscribed to:", MQTT_SUB_TOPIC);
  });
});
mqttClient.on("reconnect", () => console.log("MQTT reconnecting..."));
mqttClient.on("error", (err) => console.error("MQTT error:", err.message));
mqttClient.on("message", (topic, payload) => {
  handleIncomingMqtt(topic, payload.toString("utf8"));
});

// --- HTTP server (health + admin status)
const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("combined"));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    mqtt: { url: MQTT_URL, subscribed: MQTT_SUB_TOPIC, connected: mqttClient.connected },
    lastIngest,
    time: new Date().toISOString()
  });
});

app.get("/admin/status", adminAuth, (req, res) => {
  res.json({ ok: true, lastIngest });
});

app.listen(PORT, () => {
  console.log(`MQTT→Supabase bridge listening on :${PORT}`);
});
