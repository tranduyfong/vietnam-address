# Chuyển đổi địa chỉ hành chính Việt Nam (Cũ ⇄ Mới)

Ứng dụng 100% client-side (React + Vite + Tailwind CSS v4), không có back-end. Dữ liệu là một file JSON tĩnh
(~140 KB gzip) tải một lần, sau đó mọi tra cứu chạy trong trình duyệt.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # xuất ra dist/ – đưa lên bất kỳ static hosting nào
npm run data     # tải lại & sinh public/data/admin-2025.json (chỉ khi cần cập nhật dữ liệu)
```

## Dữ liệu

- 10.602 dòng mapping: 9.996 xã/phường cũ (63 tỉnh, 3 cấp) → 3.321 xã/phường mới (34 tỉnh, 2 cấp), hiệu lực 01/07/2025.
- Nguồn: bộ dữ liệu mở [vietnamadminunits](https://github.com/tranngocminhhieu/vietnamadminunits) (MIT),
  được đối chiếu từ sapnhap.bando.com.vn và danhmuchanhchinh.gso.gov.vn. Commit được cố định trong
  `scripts/build-admin-data.mjs` để kết quả tái lập được.
- Xã cũ bị chia cho nhiều xã mới: trả về tất cả, đánh dấu "một phần" và "mặc định" (phần diện tích chính).

## Cấu trúc

| File | Vai trò |
| --- | --- |
| `scripts/build-admin-data.mjs` | Tải CSV nguồn, sinh JSON gọn cho app |
| `public/data/admin-2025.json` | Dữ liệu đã sinh (được commit cùng mã nguồn) |
| `src/lib/addressConverter.ts` | Logic thuần: tách chuỗi, chuẩn hóa, dựng bảng tra, chuyển đổi, gợi ý |
| `src/App.tsx` | Giao diện (mobile-first) |

## Quy tắc tách chuỗi

- Dấu phân cách: `,` `.` `-` `/` `;` `|` `–` và xuống dòng. Kết quả luôn ghép bằng `" - "` (`OUTPUT_SEPARATOR`).
- Không bị tách nhầm: viết tắt `P.` `Q.` `TP.` `TX.`…, số nhà `12/3` `5-7`, tên chính thức có gạch nối
  (`Bà Rịa - Vũng Tàu`, `Phan Rang - Tháp Chàm`, `Văn Miếu - Quốc Tử Giám`…).
- Không có dấu phân cách: tự tách theo từ khóa (xã, phường, huyện, quận, tỉnh…) và tên tỉnh ở cuối chuỗi.
- So khớp không phân biệt hoa/thường, dấu, dấu nháy (`Cư M'gar`), tiền tố; hiểu `HCM`, `TPHCM`, `Q1`, `P01`…
