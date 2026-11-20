const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL;
const GAS_SECRET = process.env.GAS_SECRET;
const JUMLAH_PORTAL = Math.max(1, Number(process.env.JUMLAH_PORTAL || 6));
const LOKER_PER_PORTAL = Math.max(1, Math.min(Number(process.env.LOKER_PER_PORTAL || 3), 5));

if (!GEMINI_API_KEY || !GAS_WEBAPP_URL || !GAS_SECRET) {
  console.error("Pastikan GEMINI_API_KEY, GAS_WEBAPP_URL, dan GAS_SECRET sudah diatur di GitHub Secrets.");
  process.exit(1);
}

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

let modelTerpilih = null;

async function dapatkanDaftarModelAktif() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ListModels HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const models = Array.isArray(data?.models) ? data.models : [];

  const tersedia = models
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter(Boolean);

  // Urutkan prioritas: flash terbaru/stabil dulu
  const prioritas = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash"
  ];

  const terurut = [
    ...prioritas.filter((p) => tersedia.includes(p)),
    ...tersedia.filter((t) => !prioritas.includes(t) && t.toLowerCase().includes("flash")),
    ...tersedia.filter((t) => !prioritas.includes(t) && !t.toLowerCase().includes("flash"))
  ];

  return terurut;
}

function ekstrakJsonArray(rawText) {
  const cleaned = String(rawText || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  const jsonStr = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(jsonStr);

  if (!Array.isArray(parsed)) {
    throw new Error("Respons Gemini bukan JSON Array");
  }
  return parsed;
}

async function panggilGemini(prompt) {
  const daftarKandidat = modelTerpilih
    ? [modelTerpilih, ...(await dapatkanDaftarModelAktif())]
    : await dapatkanDaftarModelAktif();

  const unikKandidat = [...new Set(daftarKandidat)];
  if (unikKandidat.length === 0) {
    throw new Error("Tidak ada model Gemini yang mendukung generateContent pada API key ini");
  }

  let lastErr = null;

  for (const model of unikKandidat) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (res.status === 404) {
      lastErr = new Error(`Model ${model} tidak ditemukan (HTTP 404)`);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status} (${model}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const hasil = ekstrakJsonArray(text);

    if (!modelTerpilih) {
      modelTerpilih = model;
      console.log(`Menggunakan model Gemini aktif: ${modelTerpilih}`);
    }

    return hasil;
  }

  throw lastErr || new Error("Semua kandidat model Gemini gagal diakses");
}

async function run() {
  const modelsAktif = await dapatkanDaftarModelAktif();
  console.log("Model tersedia (generateContent):", modelsAktif.join(", ") || "(kosong)");

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
        `Buatkan ${LOKER_PER_PORTAL} lowongan kerja yang realistis dan relevan untuk lulusan SMK sesuai portal "${portal.namaPortal}" (${portal.urlPortal}) dan wilayah "${portal.lokasi}".\n` +
        `Balas HANYA dalam JSON Array murni tanpa markdown dengan format:\n` +
        `[{"judul":"...","perusahaan":"...","lokasi":"...","pendidikan":"SMA/SMK Sederajat","jurusan":"...","deskripsi":"..."}]`;

      const daftar = await panggilGemini(prompt);
      let masukPortal = 0;

      for (const lok of daftar) {
        semuaItems.push({
          judul: lok?.judul || `Lowongan ${portal.namaPortal}`,
          perusahaan: lok?.perusahaan || portal.namaPortal,
          lokasi: lok?.lokasi || portal.lokasi,
          pendidikan: lok?.pendidikan || "SMA/SMK Sederajat",
          jurusan: lok?.jurusan || "Semua Jurusan",
          deskripsi: lok?.deskripsi || "-",
          urlPortal: portal.urlPortal,
          namaPortal: portal.namaPortal,
          isInternasional: portal.isInternasional,
          tipeLoker: portal.tipeLoker
        });
        masukPortal++;
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
        statusText: `Error: ${err.message.slice(0, 60)}`
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
