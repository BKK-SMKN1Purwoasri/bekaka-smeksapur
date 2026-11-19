const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL;
const GAS_SECRET = process.env.GAS_SECRET;
const JUMLAH_PORTAL = Math.max(1, Number(process.env.JUMLAH_PORTAL || 6));

if (!GEMINI_API_KEY || !GAS_WEBAPP_URL || !GAS_SECRET) {
  console.error("Pastikan GEMINI_API_KEY, GAS_WEBAPP_URL, dan GAS_SECRET sudah diatur di GitHub Secrets.");
  process.exit(1);
}

// Daftar sumber portal yang ingin dirotasi saat generate
const DAFTAR_SUMBER = [
  { namaPortal: "siskop2mi bp2mi", urlPortal: "https://siskop2mi.bp2mi.go.id/lowongan/list", lokasi: "Jepang", isInternasional: true, tipeLoker: "online_internasional" },
  { namaPortal: "KitaLulus Jatim SMK", urlPortal: "https://www.kitalulus.com/lowongan", lokasi: "Surabaya, Jawa Timur", isInternasional: false, tipeLoker: "online_jatim" },
  { namaPortal: "Glints Jatim Kediri", urlPortal: "https://glints.com/id/opportunities/jobs/explore", lokasi: "Kediri, Jawa Timur", isInternasional: false, tipeLoker: "online_jatim" },
  { namaPortal: "Glints Jatim Surabaya", urlPortal: "https://glints.com/id/opportunities/jobs/explore", lokasi: "Surabaya, Jawa Timur", isInternasional: false, tipeLoker: "online_jatim" },
  { namaPortal: "Glints Jatim Malang", urlPortal: "https://glints.com/id/opportunities/jobs/explore", lokasi: "Malang, Jawa Timur", isInternasional: false, tipeLoker: "online_jatim" },
  { namaPortal: "Karir.com SMK", urlPortal: "https://karir.com/search-lowongan", lokasi: "Jawa Timur", isInternasional: false, tipeLoker: "online_jatim" },
  { namaPortal: "Jobstreet Jatim Jombang", urlPortal: "https://id.jobstreet.com/id/SMA-SMK-jobs/in-Jombang-Jawa-Timur", lokasi: "Jombang, Jawa Timur", isInternasional: false, tipeLoker: "online_jatim" },
  { namaPortal: "Jobstreet Jatim Blitar", urlPortal: "https://id.jobstreet.com/id/SMA-SMK-jobs/in-Blitar-Jawa-Timur", lokasi: "Blitar, Jawa Timur", isInternasional: false, tipeLoker: "online_jatim" },
  { namaPortal: "KarirHub Kemnaker Jatim", urlPortal: "https://karirhub.kemnaker.go.id/lowongan-dalam-negeri/lowongan", lokasi: "Jawa Timur", isInternasional: false, tipeLoker: "online_jatim" }
];

async function panggilGemini(prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  const jsonStr = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(jsonStr);
}

async function run() {
  // Rotasi sumber berdasarkan jam agar tiap run memvariasikan portal
  const offset = Math.floor(Date.now() / 3600000) % DAFTAR_SUMBER.length;
  const batchPortal = [];
  for (let i = 0; i < Math.min(JUMLAH_PORTAL, DAFTAR_SUMBER.length); i++) {
    batchPortal.push(DAFTAR_SUMBER[(offset + i) % DAFTAR_SUMBER.length]);
  }

  const semuaItems = [];
  const statusUpdates = [];

  for (const portal of batchPortal) {
    try {
      const prompt =
        `Buatkan 3 lowongan kerja yang realistis dan relevan untuk lulusan SMK sesuai portal "${portal.namaPortal}" (${portal.urlPortal}) dan wilayah "${portal.lokasi}".\n` +
        `Balas HANYA dalam JSON Array murni tanpa markdown dengan format:\n` +
        `[{"judul":"...","perusahaan":"...","lokasi":"...","pendidikan":"SMA/SMK Sederajat","jurusan":"...","deskripsi":"..."}]`;

      const daftar = await panggilGemini(prompt);
      let masukPortal = 0;

      if (Array.isArray(daftar)) {
        for (const lok of daftar) {
          semuaItems.push({
            judul: lok.judul || `Lowongan ${portal.namaPortal}`,
            perusahaan: lok.perusahaan || portal.namaPortal,
            lokasi: lok.lokasi || portal.lokasi,
            pendidikan: lok.pendidikan || "SMA/SMK Sederajat",
            jurusan: lok.jurusan || "Semua Jurusan",
            deskripsi: lok.deskripsi || "-",
            urlPortal: portal.urlPortal,
            namaPortal: portal.namaPortal,
            isInternasional: portal.isInternasional,
            tipeLoker: portal.tipeLoker
          });
          masukPortal++;
        }
      }

      statusUpdates.push({
        namaPortal: portal.namaPortal,
        urlPortal: portal.urlPortal,
        statusText: `Selesai (${masukPortal} loker)`
      });
      console.log(`OK: ${portal.namaPortal} -> ${masukPortal} loker`);
    } catch (err) {
      console.error(`Gagal ${portal.namaPortal}: ${err.message}`);
      statusUpdates.push({
        namaPortal: portal.namaPortal,
        urlPortal: portal.urlPortal,
        statusText: `Error: ${err.message.slice(0, 50)}`
      });
    }
  }

  const postRes = await fetch(GAS_WEBAPP_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: GAS_SECRET,
      items: semuaItems,
      statusUpdates
    })
  });

  const postResult = await postRes.text();
  console.log("Respon Apps Script:", postResult);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
