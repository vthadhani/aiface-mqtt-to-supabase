async function ensureDeviceRow(supabase, device_sn) {
  if (!device_sn) return;

  // Upsert device record (store_id mapping can be set later in POS UI)
  const { error } = await supabase
    .from("devices")
    .upsert({ device_sn }, { onConflict: "device_sn" });

  if (error) {
    // Not fatal — punches still get stored
    console.error("devices upsert error:", error.message);
  }
}

async function insertPunches(supabase, punches) {
  if (!punches.length) return { inserted: 0 };

  const { error } = await supabase
    .from("attendance_punches")
    .insert(punches);

  if (error) {
    console.error("attendance_punches insert error:", error.message);
    return { inserted: 0, error: error.message };
  }

  return { inserted: punches.length };
}

module.exports = { ensureDeviceRow, insertPunches };
