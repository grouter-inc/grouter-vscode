# Audit Fitur — gRouter for VS Code

Audit menyeluruh: **apakah setiap fitur yang dijanjikan beneran jalan?**

Ditulis dalam bahasa awam. Semua temuan di bawah punya bukti perintah + output, bukan opini.

Versi: `0.4.0` · Tanggal: 18 Oktober 2026

---

## Kenapa audit ini perlu

Versi 0.3.2 punya **154 test yang lulus semua** — tapi user tetap nemu error saat
kirim pesan chat. Artinya test-nya **gak nangkep masalah yang nyata**.

Setelah ditelusuri, ketemu sebabnya:

> Test kita **ganti VS Code dengan tiruan bikinan sendiri.**

File `vitest.config.mts` mengarahkan setiap `import ... from "vscode"` ke
`test/stubs/vscode.ts` — tiruan yang ditulis manual. Jadi test lulus melawan
**VS Code palsu**, bukan VS Code yang lo pakai.

| | |
|---|---|
| API VS Code yang dipakai kode | **41** |
| Ada di tiruan | **17** |
| **Tidak ada di tiruan** | **24** |

Di antara 24 yang hilang: **`ChatResponseStream`** — objek yang justru bikin
error chat. Mustahil ketangkep, karena test-nya gak pernah nyentuh objek itu.

**Kesimpulan:** masalahnya bukan "kurang banyak test", tapi test yang **ngasih
rasa aman palsu**.

---

## Yang diperbaiki

### 1. Harness test di VS Code asli

Sekarang ada test yang jalan **di dalam VS Code yang beneran**:

```bash
npm run test:host
```

VS Code di-download otomatis (sekali, ~120MB), lalu 13 test dijalankan di dalam
extension host sungguhan. Test ini ngakses `vscode` yang asli — bukan tiruan.

**Langsung nemu 2 masalah di percobaan pertama.** Itu bukti harness-nya bekerja.

---

### 2. Lima tool GAK PERNAH JALAN

**Gejala** (dari VS Code asli):

```
Tool "grouter_list_skills" was not contributed.
Tool "grouter_read_skill" was not contributed.
Tool "grouter_create_skill" was not contributed.
Tool "grouter_delete_skill" was not contributed.
Tool "grouter_delegate_to_specialist" was not contributed.
```

**Artinya:** 4 tool skill + 1 tool sub-agent **ditolak VS Code**. Fitur skills
dan sub-agent — yang jadi selling point — **mati total**.

**Sebabnya:**

VS Code mewajibkan setiap tool didaftar di dua tempat:

1. `registerTool()` di kode — **ada**
2. `contributes.languageModelTools` di `package.json` — **cuma 20, padahal butuh 25**

Karena 5 tool gak ada di daftar nomor 2, VS Code **tolak** pendaftarannya.

**Kenapa daftarnya cuma 20?** Generator manifest-nya jalan begini:

```js
const registry = createDefaultRegistry();  // tanpa opsi apa pun
```

Tanpa opsi, registry menghasilkan **20** tool. Tapi saat extension jalan
sungguhan, dia dikasih skill engine + delegation context → jadi **25**.

**Dua angka ini gak akan pernah sama** selama manifestnya dibuat dari registry
kosong. Bukan soal lupa ngejalanin ulang — **desainnya memang cacat.**

**Perbaikannya:** generator sekarang dikasih stand-in untuk dua dependency itu,
jadi selalu menghasilkan **25/25**. Generator juga lapor tool mana yang
ditambah/dihapus.

**Bukti sudah beres:**

| | Sebelum | Sesudah |
|---|---|---|
| `Tool ... was not contributed` | **5 kali** | **0 kali** |
| Tool terdaftar | 20 | **25** |

---

### 3. Empat pengaturan GAK ADA EFEKNYA

`contributes.configuration` menampilkan **5** setting di Settings UI:

| Setting | Beneran dipakai? |
|---|---|
| `grouter.mcp.port` | ✅ ya |
| `grouter.baseUrl` | ❌ **tidak** |
| `grouter.model` | ❌ **tidak** |
| `grouter.reasoning.show` | ❌ **tidak** |
| `grouter.telemetry.enabled` | ❌ **tidak** |

**Masalahnya:** user buka Settings, ubah 4 setting itu, **gak ada yang berubah**,
dan **gak ada pesan error**. Jebakan halus.

**Sebabnya:** ada dua sistem config yang gak nyambung:

- **`~/.grouter/config.json`** → ini yang dipakai runtime
- **VS Code Settings UI** → cuma `mcp.port` yang nyambung ke runtime

**Perbaikannya:** VS Code Settings sekarang jadi **lapisan override** di atas
file config. Urutan menang: Settings → file config → default.

Kalau lo gak pernah buka Settings, isi `config.json` yang dipakai — jadi gak ada
yang ketimpa.

---

### 4. Kode mati

`modeNotice()` isinya cuma `return undefined`. Akibatnya blok kode yang
memanggilnya **gak pernah jalan** sama sekali. Sudah dihapus.

---

## Yang diverifikasi BENAR (jangan diutak-atik)

Semua klaim angka di README **terbukti cocok** dengan kode:

| Klaim README | Hasil verifikasi |
|---|---|
| 25 in-editor tools | ✅ 21 statis + 4 skill |
| 12 MCP tools | ✅ sesuai `headlessRegistry` |
| 25 skills | ✅ sesuai folder |
| 8 command palette | ✅ 8 handler ada semua |
| 7 sub-command chat | ✅ ketujuhnya sampai ke handler |
| Pola Proxy berbahaya | ✅ 0 sisa |
| Keybinding → command | ✅ 0 yang nyasar |
| Menu → command | ✅ 0 yang nyasar |

---

## Status akhir

| Pemeriksaan | Hasil |
|---|---|
| Typecheck (`npm run check`) | **EXIT 0** |
| Test offline (`npx vitest run test/unit` + integration offline) | **223/223 lulus** (198 unit + 25 integration, 0 jaringan) |
| Test VS Code asli (`npm run test:host`) | **17/17 lulus** |
| Tool ditolak VS Code | **0** |
| Setting mati | **0** |
| Command tanpa handler | **0** |

---

## Guard biar gak kejadian lagi

Tiga test baru mengunci celah ini supaya gagal **di CI**, bukan di komputer user:

| Test | Nangkep apa |
|---|---|
| `test/host/suite.ts` | Jalan di VS Code asli; ngecek API yang cuma ada di sana |
| `test/unit/toolManifest.test.ts` | Tool didaftar runtime tapi gak ada di manifest → gagal |
| `test/unit/settingsContract.test.ts` | Setting muncul di UI tapi gak dibaca kode → gagal |

Aturan yang ditegakkan:

> **Setiap tool yang bisa didaftarkan extension WAJIB ada di manifest.**
> **Setiap setting yang tampil di Settings UI WAJIB dibaca kode.**

Kalau ada yang nambah tool/setting tapi lupa nyambungin, test-nya langsung merah.

---

## Cara verifikasi sendiri

```bash
git clone https://github.com/grouter-inc/grouter-vscode
cd grouter-vscode
npm install

npm run check      # typecheck — harus EXIT 0
npx vitest run test/unit  # 198 test (offline)
npm run test:host  # 17 test di VS Code asli (download VS Code sekali)
```

---

## Bug 4 — Agent bisa klaim "selesai" padahal BELUM (0.4.0)

**Gejala:** sebelum 0.4.0, agent bisa nutup turn dengan "semua test sudah lulus"
tanpa pernah jalanin satu test pun. Gak ada satu baris kode yang ngebandingin
klaim itu sama kenyataan.

**Bukti dari kode lama:** di `src/chat/participant.ts` gak ada pemeriksaan apa pun
sebelum turn ditutup — hasil `streamAgentRun` langsung dipakai. Kata `evidence`
cuma muncul **1 kali** di seluruh `src/`, `loop` **0 kali**.

**Akibatnya:** user commit kode yang test-nya merah. Ini kelemahan paling fatal,
karena ngerusak kepercayaan ke semua jawaban lain.

**Yang dibikin sekarang:**

| Komponen | File | Fungsi |
|---|---|---|
| Pengumpul bukti | `src/agent/verify/evidence.ts` | Jalanin test suite, typecheck, `git diff --stat`; baca **exit code asli** |
| Verify gate | `src/chat/participant.ts` (blok `finally`) | Deteksi klaim selesai → verifikasi → tolak kalau merah |
| Tool `verify_work` | `src/tools/builtin/verifyTools.ts` | Agent bisa minta bukti sendiri sebelum klaim |
| Ralph loop | `src/agent/ralph/loop.ts` | Loop kerja→verifikasi→umpan balik, **bukti diambil loop**, bukan agent |
| HUD | `src/ui/hud.ts` | Status bar: mode, iterasi, tool call, token, status verifikasi |

**Dikunci test:**

| Test | Nangkep apa |
|---|---|
| `test/unit/verifyGate.test.ts` (28) | Klaim palsu lolos; kalimat jujur ("still fail") ikut diblokir; parser test rusak |
| `test/unit/ralphLoop.test.ts` (16) | Loop lapor `verified` padahal merah; berhenti di error sama; cancel diabaikan |
| `test/unit/hud.test.ts` (19) | HUD crash tanpa VS Code; counter hilang dari status bar |

**Aturan yang ditegakkan sekarang:**

> **Agent gak boleh nutup turn dengan klaim sukses kalau bukti verifikasi merah.**
> **Loop `/ralph` cuma boleh lapor `verified` kalau semua cek benar-benar exit 0.**

---

## Bug 5 — Extension gak nunjukin apa-apa pas kerja (0.4.0)

**Gejala:** `contributes.views` isinya `{}` dan gak ada status bar item sama sekali.
Selama agent kerja — yang bisa makan puluhan detik dan puluhan tool call — user
cuma lihat spinner tanpa konteks: gak tau mode apa, step ke berapa, berapa token
kepake, test lulus atau nggak.

**Sekarang:** HUD di status bar nampilin mode, iterasi ralph, plan step, jumlah tool
call, token, dan status verifikasi terakhir. Bisa dimatiin lewat `grouter.hud.enabled`.

---

## Bug 3 — Cara dapat API key salah total

**Gejala:** panduan dulu salah — nyuruh user daftar di prod.grouter.web.id, buka
dashboard, lalu klik tombol bikin key. Padahal **gak ada** pendaftaran, **gak ada**
dashboard, **gak ada** bikin key sendiri.

**Akibatnya:** setiap user baru **mentok di langkah 3** — gak akan pernah dapet key.

**Alur yang benar** (dari situs resmi, bagian *Cara Beli*):

1. Buka bot Telegram **https://t.me/grouteerbot**
2. Pilih paket (contoh: Starter, 15 juta token, Rp19.000)
3. Bayar **pakai QRIS**
4. Key **dikirim otomatis** ke chat — diawali `grx_`

**Yang salah dan sudah dibenerin:**

| Tempat | Dulu salah (keliru) | Sekarang benar |
|---|---|---|
| `docs/USER-GUIDE.md` bab 5 | salah: suruh daftar + klik "Create Key" | benar: beli via bot Telegram, bayar QRIS |
| `README.md` | salah: "Get an API key → prod.grouter.web.id" | benar: "→ Telegram bot (QRIS)" |
| Prefix key | salah: prefix lama keliru, bukan `grx_` | benar: `grx_...` |
| `src/commands/index.ts` | salah: prompt nyebut prefix lama | benar: `starts with grx_`, plus link bot |
| `src/chat/participant.ts` | salah: cuma nyuruh edit config | benar: "Buy one from t.me/grouteerbot" |
| `src/llm/errors.ts` | salah: cuma "Set a valid key" | benar: "Get a new one from t.me/grouteerbot" |
| `docs/PRD.md`, `docs/ARCHITECTURE.md` | salah: tombol "Open API Keys Dashboard" | benar: "Buy a plan via Telegram" |

**Dikunci test:** `test/unit/apiKeyOnboarding.test.ts` — kalau ada yang nulis lagi
"Create Key", "dashboard", atau prefix salah, test **gagal**.

---
