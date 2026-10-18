# Kalau pesan lo error hari ini — ini penjelasannya

## Ringkasan singkat

Lo nemu **bug di gRouter versi 0.3.1**. Bug-nya bikin chat **gagal setiap kali** lo kirim pesan.

**Bug-nya udah dibenerin. Versi 0.3.2 udah LIVE.**

---

## Langkah perbaikan (buat yang awam)

**Cara 1 — Lewat VS Code (paling gampang):**

1. Buka VS Code
2. Tekan `Ctrl+Shift+P`
3. Ketik: `Extensions: Check for Extension Updates`
4. Enter
5. Kalau ada update, klik **Update**
6. **Restart VS Code**: `Ctrl+Shift+P` → ketik `Developer: Reload Window` → Enter

**Cara 2 — Lewat terminal:**

```bash
code --install-extension grouter.grouter-code
```

Terus restart VS Code.

### Cara paling yakin (kalau dua cara di atas gak jalan)

Hapus dulu, baru install ulang:

```bash
code --uninstall-extension grouter.grouter-code
code --install-extension grouter.grouter-code
```

Terus **tutup VS Code sepenuhnya dan buka lagi**.

---

## Cara cek versi lo sekarang berapa

1. Tekan `Ctrl+Shift+X` (buka Extensions)
2. Cari **gRouter**
3. Di bawah namanya ada tulisan versi — **harusnya `0.3.2`**

Kalau masih `0.3.1`, ulangi langkah di atas.

---

## Yang berubah

| | 0.3.1 | 0.3.2 |
|---|---|---|
| Chat | ❌ Error terus | ✅ Jalan |
| Dokumentasi awam | — | ✅ Ada ([USER-GUIDE](USER-GUIDE.md)) |

---

## Sesi lo aman

Bug ini **cuma bikin chat gagal muncul**. Dia gak ngerusak:
- File kode lo
- Pengaturan lo
- API key lo
- Riwayat obrolan sebelumnya

Gak ada yang perlu diperbaiki manual — cukup update, terus langsung bisa dipakai.

---

## Masih error setelah update?

Kumpulin info ini, terus lapor:

1. **Versi gRouter** — `Ctrl+Shift+X`, cari gRouter, lihat angkanya
2. **Versi VS Code** — menu **Help → About**, lihat tulisan `Version:`
3. **Pesan error** — copy lengkapnya
4. **Log** — `Ctrl+Shift+P` → `gRouter: Show Diagnostics`
   Atau: **View → Output** → pilih **gRouter** di dropdown kanan atas

**Lapor ke mana:**
- 🐛 https://github.com/grouter-inc/grouter-vscode/issues
- 🤖 https://t.me/grouteerbot

Tulis aja apa adanya — kalau ada yang bingung, sebut aja bagian mananya.

---

## Buat yang penasaran teknis

Pesan error lengkapnya:

```
get on proxy: property 'markdown' is a read-only and non-configurable data
property on the proxy target but the proxy did not return its actual value
```

**Penyebabnya:** kode lama membungkus *response stream* VS Code pakai `Proxy` JavaScript, biar teks yang di-stream bisa ditangkap. Tapi VS Code mendefinisikan `markdown` sebagai read-only dan non-configurable. Aturan Proxy di JavaScript melarang sebuah trap mengembalikan nilai yang berbeda dari property data yang non-configurable dan non-writable — jadi mesin JavaScript melempar error begitu property-nya diakses.

**Kenapa lolos ke rilis:** semua test memakai *stream tiruan* dengan property biasa yang writable, jadi aturan itu gak pernah tersentuh.

**Perbaikannya:** `Proxy` dihapus. Agent sekarang menulis lewat objek facade biasa; stream aslinya tidak pernah di-proxy, jadi tidak ada aturan yang bisa dilanggar.

**Dikunci oleh:** `test/unit/streamCapture.test.ts` — test ini membangun stream dengan bentuk persis seperti yang dibuat VS Code (`writable: false, configurable: false`) dan memastikan (a) pola Proxy lama tetap melempar error, dan (b) facade-nya tidak.
