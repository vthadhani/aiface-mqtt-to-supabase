function safeParseJson(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function toIsoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizePunch(deviceSn, msg, rec) {
  const punchTimeIso =
    toIsoOrNull(rec.time) ||
    toIsoOrNull(msg.cloudtime) ||
    new Date().toISOString();

  const enrollid = typeof rec.enrollid === "number"
    ? rec.enrollid
    : parseInt(String(rec.enrollid || "0"), 10);

  return {
    device_sn: deviceSn || rec.sn || msg.sn || null,
    enrollid,
    punch_time: punchTimeIso,
    inout: rec.inout === undefined ? null : Number(rec.inout),
    mode: rec.mode === undefined ? null : Number(rec.mode),
    event: rec.event === undefined ? null : Number(rec.event),
    verifymode: rec.verifymode === undefined ? null : Number(rec.verifymode),
    temp: rec.temp === undefined ? null : Number(rec.temp),
    image_base64: rec.image ? String(rec.image) : null,
    raw_json: { msg, rec }
  };
}

module.exports = { safeParseJson, normalizePunch };
