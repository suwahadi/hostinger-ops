# DESIGN.md

Catatan arah visual yang diukur dari situs hidup `https://www.bintangbongkarjaya.com/` pada 18 November 2026. Ini rekaman tampilan yang ada, bukan rancangan baru.

Pengukuran desktop memakai viewport Playwright 1440 x 900 CSS pixel. Tinggi halaman beranda 8132 px. Pengukuran ponsel memakai 390 x 844. Tidak ada overflow horizontal di 390 px. Animasi, slider, dan efek masuk tidak wajib ditiru.

Tema terpasang: WordPress, Themify Ultra, skin `furniture`. Lebar isi dalam (`pagewidth`) sekitar 1160 px. Baris penuh memakai lebar viewport.

## Bacaan desain

Beranda jasa bongkar bangunan untuk pemilik properti di Jabodetabek. Bahasa visual: perusahaan konstruksi, foto alat berat, biru dongker, dan satu aksen oranye. Dial yang terbaca dari situs ini: ENERGY 2 / RHYTHM 2 / MOTION 1.

MOTION 1 adalah keputusan spec ini. Situs hidup memakai slider dan gerakan masuk. Spec ini tidak mewajibkan gerakan itu.

## Warna

Nilai di bawah diambil dari `getComputedStyle`, lalu ditulis sebagai hex.

| Nama | Hex | Pemakaian |
| --- | --- | --- |
| Dongker | `#012F6D` | Bilah atas, tombol "Get A Quote", panel layanan, pita bantuan, footer (`#footerwrap`) |
| Dongker aktif | `#0E479C` | Item menu yang sedang aktif. "Home" di beranda: latar ini, teks putih |
| Dongker tombol | `#003887` | Tombol "Read More" di blok tentang |
| Oranye | `#FE6500` | Label kecil di atas judul ("Best Service", "Layanan Lainnya"). Bukan warna tombol utama |
| Tinta | `#222222` | Teks isi |
| Hitam judul | `#000000` | Sebagian judul |
| Abu lembut | `#737272` | Label kecil di bawah kontak header ("Area Layanan Kami", "Telp/Whatsapp") |
| Abu pita | `#EEEEEE` | Pita statistik di atas foto rumah, dan teks footer |
| Putih | `#FFFFFF` | Dasar halaman, kartu, header |
| Hijau WhatsApp | lingkaran mengambang kiri bawah | Tombol chat tetap |
| Biru telepon | lingkaran mengambang di bawah WhatsApp | Tombol telepon tetap |

Palet inti: dongker, oranye, putih. Hitam dan abu adalah netral.

## Huruf

Yang terukur pada elemen yang tampil:

| Peran | Keluarga | Ukuran / tebal |
| --- | --- | --- |
| Isi, menu tidak aktif, label kecil, tombol | Heebo | Isi 15 px / 400, rata kiri. Paragraf tentang: 15 px, rata kanan-kiri. Menu 15 px / 400. "Get A Quote" 10.8 px / 400. "Read More" 12 px / 400 |
| Menu yang aktif | Raleway | 15 px / 500, padding 16 px 30 px, tinggi 49 px |
| Judul bagian | Poppins | 25 px hingga 30 px, tebal 500. "Galeri Kami" 25 px / 500, warna `#012F6D`. "PROFESIONAL DALAM SETIAP PROYEK" tampil sebagai judul besar hitam |
| Angka "9+ Tahun" | Open Sans | 20 px / 600, putih, di dalam kotak dongker |
| Kontak di header | Poppins untuk angka dan "Jabodetabek" | 16 px / 600, `#222222`. Keterangan di bawahnya Heebo 10 px, `#737272` |
| Footer isi | Heebo | 13 px, warna `#EEEEEE` di atas dasar `#012F6D` |
| Judul kolom footer | Poppins | 15.6 px hingga 20 px, putih |

Berkas font yang juga termuat tema, tetapi bukan wajah utama yang terukur pada judul tampil: Frank Ruhl Libre, Montserrat, dan Metal. Jangan mengganti Poppins atau Heebo dengan keluarga itu.

Logo adalah gambar, bukan huruf: `wp-content/uploads/2024/07/logo-Bintang-Bongkar-Jaya-1.png`. Pakai berkas itu. Jangan menggambar logo baru.

## Tombol dan bentuk

- "Get A Quote" dan "Read More" (blok tentang): kapsul, `border-radius: 100px`, tanpa border, teks putih.
- "Get A Quote": latar `#012F6D`, padding 10 px 20 px.
- "Read More" tentang: latar `#003887`, padding 12 px 20 px 10 px.
- "Read More" pada kartu layanan lain: tautan teks biru, bukan kapsul.
- Menu aktif tidak berbentuk kapsul. Itu persegi panjang setinggi bilah menu.
- Kartu keunggulan: garis tepi tipis, sudut kecil, satu kartu (yang ketiga) terisi dongker dengan teks putih.
- Kotak pencarian di ujung menu: lingkaran putih, ikon gelap.

## Chrome yang mengunci di setiap halaman

Urutan dari atas:

1. Bilah atas, tinggi 49 px, dasar `#012F6D`, teks putih Heebo. Kiri: "Jasa Bongkar Bangunan" dan "Buka Senin s/d Minggu: 08.00 - 20.00 WIB". Kanan: "Follow Us" lalu empat ikon bulat (Facebook, Instagram, TikTok, YouTube). Di 390 px teks jam memendek menjadi "Buka Setiap Hari", dan ikon sosial hilang dari bilah ini.
2. Header putih. Kiri: logo. Kanan, sebelum menu: blok "Jabodetabek / Area Layanan Kami", blok nomor "0859 2624 6601 / Telp/Whatsapp", lalu "Get A Quote". Di 390 px ketiga blok kanan itu disembunyikan. Yang tersisa logo dan ikon hamburger.
3. Menu, tinggi 49 px, dasar dongker, teks putih. Butir: Home, Tentang Kami, Layanan (punya anak), Galeri, Testimoni, Blog, Kontak. Anak Layanan: Jasa Bongkar Bangunan, lalu wilayah Jakarta Pusat, Jakarta Selatan, Jakarta Barat, Jakarta Timur, Jakarta Utara, Tangerang, Depok, Bekasi, Bogor, kemudian Jasa Pembersihan Lokasi dan Jual Beli Barang Bekas. Ujung kanan: tombol cari bulat. Di ponsel menu ini menjadi ikon tiga garis.
4. Dua tombol bulat menempel di kiri bawah: WhatsApp hijau, telepon biru. Keduanya tetap terlihat saat digulir.
5. Tombol bulat "kembali ke atas" di kanan bawah.
6. Footer `#footerwrap`, dasar `#012F6D`. Empat kolom: identitas, Kontak Kami, Galeri (kisi foto), Info Terbaru (daftar tulisan). Judul kolom kanan terlihat bergaris aksen pendek. Garis itu bukan `border-bottom` pada `h5`. Hak cipta di tengah bawah: "© 2024 Bintang Bongkar Jaya. All Rights Reserved. Published by www.eda.co.id".

## Beranda, dari atas ke bawah

Lebar kolom di dalam isi mengikuti grid Themify. Angka tinggi di bawah adalah tinggi baris yang terukur di 1440 px.

```text
[ bilah atas dongker ]
[ header putih: logo | jabodetabek | telepon | Get A Quote ]
[ menu dongker ....................................... (cari) ]
[ hero foto alat berat, tinggi sekitar 800 ]
[ selamat datang | nama perusahaan | lencana Best Service ]
[ tentang: teks kiri | foto + angka 9+ | kutipan ]
[ 4 kartu keunggulan, kartu ke-3 terisi dongker ]
[ foto rumah penuh + statistik 135+ dan 98% menumpuk di kanan ]
[ pita "Layanan Kami" menumpuk di foto, lalu kalimat pengantar rata kanan ]
[ 6 kartu jasa, 3 kolom x 2 baris ]
[ pita "Butuh Bantuan?" + foto ]
[ 3 foto kecil + judul "Layanan Lainnya" ]
[ 2 kartu: pembersihan lokasi, jual beli barang bekas ]
[ Galeri Kami | foto lebar ]
[ foto samar + 3 poin kiri + judul Testimonial + foto ]
[ slogan di atas pita titik-titik | kenop Area Layanan ]
[ kutipan "Teknologi Modern, Hasil Maksimal" ]
[ Blog & Artikel | daftar tautan wilayah ]
[ footer 4 kolom ]
```

### Hero

Tinggi baris sekitar 800 px, latar foto ekskavator dan rumah yang sedang dibongkar, sisi kanan bertepi sobek. Teks kiri, bertumpuk:

- "Jasa Konstruksi"
- "Bongkar Gedung", judul terbesar, dongker
- "JABODETABEK", lebih kecil, abu

Kiri bawah foto: kapsul "Bintang Bongkar Jaya", lalu dua baris "Tim Profesional" dan "Peralatan Memadai". Kanan bawah: dua lingkaran foto berlabel "Bongkar Tuntas" dan "Bersih & Rapi". Kanan atas: kenop "Area Layanan / Jabodetabek". Pojok kanan bawah foto: "BEST SERVICE", kata SERVICE berwarna oranye.

Ada kontrol slider (titik). Spec ini tidak mewajibkan perpindahan slide.

### Selamat datang

Dasar putih, padding baris 40 px 0. Tiga bagian sejajar, dipisah garis tegak tipis:

- Kanan-kiri teks: "Selamat Datang di" (Poppins 22 px) dan URL situs di bawahnya (Heebo 13 px).
- Tengah: "Bintang Bongkar Jaya" berwarna dongker, di bawahnya ikon info dan "Spesialis Bongkar Bangunan".
- Kanan: kapsul abu sangat muda, ikon jempol, teks "Best Service".

### Tentang

Label oranye "Best Service" di kiri judul. Judul hitam dua baris: "PROFESIONAL DALAM SETIAP PROYEK". Di bawah judul ada garis biru pendek, bukan nomor.

Kiri: dua paragraf tentang perusahaan sejak 2015, lalu tombol kapsul "Read More" ke `/tentang-kami/`.

Tengah: foto ekskavator. Di atas pojok foto, kotak dongker "9+ Tahun / Pengalaman Kami". Di bawah foto, kartu putih berisi logo kecil dan "Spesialis Bongkar Bangunan". Ada pola titik halus di belakang foto. Pola itu milik komposisi ini, bukan latar seluruh halaman.

Kanan: tanda kutip besar, lalu kalimat miring tentang standar profesionalisme.

### Empat keunggulan

Satu baris, empat kartu hampir sama lebar (sekitar 200 px). Nomor kecil 01 sampai 04 di pojok kartu. Ikon garis biru. Judul Poppins 15.6 px. Isi Heebo 13 px.

1. Profesional
2. Peralatan Memadai
3. Kepuasan Pelanggan, kartu ini saja yang terisi dongker dan teksnya putih
4. Biaya Terjangkau

### Pita foto dan statistik

Foto rumah yang dibongkar, selebar viewport, tinggi baris sekitar 366 px, padding bawah 80 px. Di kanan, dua blok menumpuk di atas foto:

- Putih: "135+" lalu "Proyek Selesai" dengan centang, di sampingnya panel dongker.
- Putih: "98%" lalu "Happy Customer".

Angka ini tertulis di situs referensi. Jangan menambah angka lain.

### Layanan utama

Panel dongker menumpuk di tepi bawah foto: "Bintang Bongkar Jaya" kecil, lalu "Layanan Kami" putih Poppins 28 px / 500.

Di bawahnya, satu kalimat rata kanan: layanan pembongkaran di Jabodetabek.

Lalu enam kartu, tiga kolom. Setiap kartu: foto dengan label "LAYANAN" dan "Bintang Bongkar Jaya", meta "Service" plus nomor 01 sampai 06, judul, paragraf. Judulnya:

1. Bongkar Gedung
2. Bongkar Rumah Tinggal
3. Bongkar Pabrik & Gudang
4. Bongkar Struktur Baja
5. Bongkar Partisi
6. Bongkar Genteng

### Butuh bantuan

Baris penuh, tinggi sekitar 138 px. Kiri panel dongker: "Butuh Bantuan?", ikon telepon oranye, "Hubungi kami:", lalu "WhatsApp" dan nomor. Kanan: foto lokasi, pada tangkapan ini sempat tampil sebagai bidang abu sebelum gambar selesai. Pertahankan slot foto, jangan jadikan kotak abu sebagai desain akhir.

### Layanan lainnya

Tiga foto kecil sejajar di kanan. Kiri foto itu, label oranye "Layanan Lainnya". Judul hitam: "KEBERLANJUTAN DALAM SETIAP PILIHAN".

Dua kartu besar di bawahnya, bernomor 01 dan 02:

- Jasa Pembersihan Lokasi
- Jual Beli Barang Bekas

Masing-masing punya foto, meta "Service", judul, paragraf, dan tautan teks "Read More".

### Galeri

"Galeri Kami" Poppins 25 px / 500, warna `#012F6D`. Di bawahnya: "Menangani lebih dari 100+ Klien". Kanan judul: foto lebar reruntuhan. Di bawahnya deretan foto yang boleh digeser. Geseran tidak wajib.

### Testimoni

Kiri, tiga baris bertumpuk. Yang pertama kartu dongker: "Bergaransi / Jaminan hasil yang maksimal." Dua berikutnya putih: "Profesional" dan "Dedikasi".

Kanan: judul "Testimonial", subjudul "Tetimoni para pelanggan kami:" (ejaan mengikuti situs), lalu satu foto alat di dalam bangunan. Titik slider ada di kanan foto. Isi kutipan pelanggan tidak terlihat sebagai teks pada pengukuran ini. Jangan mengarang nama atau kutipan.

### Area layanan

Foto lebar yang sengaja tampil lembut di belakang. Di atas pita titik halus: "Bongkar Tuntas Sampai Bersih!!" warna `#012F6D`, rata kanan, lalu "Bintang Bongkar Jaya" dengan ikon kecil. Kanan pita: kenop putih "Area Layanan" dan kapsul dongker "Jabodetabek".

Di bawah: tanda kutip, judul "Teknologi Modern, Hasil Maksimal", dan paragraf kerja sama dengan klien.

### Blog

Kartu abu muda kiri: kapsul "New Post", judul "Blog & Artikel", satu kalimat pengantar. Kanan dan bawah: daftar tautan wilayah (Bogor, Bekasi, Depok, Jakarta Pusat, dan seterusnya) dengan meta "Layanan" dan ikon komentar. Daftar ini adalah tautan sungguhan ke halaman yang ada di situs.

## Ponsel

Di 390 px tidak ada gulir mendatar. Bilah atas tetap dongker dan lebih ringkas. Header menjadi logo plus hamburger. Hero tetap satu gambar, teks dan lingkaran foto mengecil di dalam gambar yang sama. Blok selamat datang menjadi dua baris: sapaan di atas, nama perusahaan dan lencana "Best Service" di sampingnya. Judul tentang menjadi penuh lebar. Tombol WhatsApp dan telepon tetap menempel dan sempat menutupi tepi kiri teks. Itu bagian dari tampilan yang terukur. Saat implementasi, jangan biarkan tombol itu menutupi huruf.

## Yang tidak ditiru

- Perpindahan slide hero, galeri, dan testimoni.
- Efek masuk "wow", fade, atau parallax.
- Gerakan ikon mengambang.

Yang tetap ada tanpa animasi: foto, susunan, warna, huruf, dan tombol yang benar-benar menuju suatu tempat.

## Aset

Pakai foto dan logo yang sudah tampil di situs referensi. Jangan membuat logo, wajah orang, atau ilustrasi baru. Daftar aset utama ada di unggahan `wp-content/uploads/2024/07/` pada domain yang sama.

## Alasan singkat

- Dongker `#012F6D` adalah warna bilah, menu, footer, dan panel, jadi itulah warna merek yang terukur.
- Oranye `#FE6500` hanya pada label kecil, supaya tidak menyaingi dongker.
- Heebo untuk teks panjang karena itulah huruf isi yang terukur. Poppins untuk judul karena itulah huruf judul yang terukur.
- Kapsul 100 px hanya pada tombol kecil yang sudah berbentuk kapsul. Kartu tidak ikut dipaksa menjadi kapsul.
- Kartu keunggulan ketiga diisi dongker karena situs memakai satu kartu terisi untuk memecah deretan, bukan karena setiap kartu harus sama.
- Angka 9+, 135+, 98%, dan 100+ dicatat karena tertulis di referensi. Jangan menambah statistik baru.
