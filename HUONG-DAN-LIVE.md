# Kéo Co Hội Làng: hướng dẫn live

**Chạy:** nhấp đúp `START.bat`. LIVE Studio thêm nguồn trình duyệt `http://localhost.game:3946/`, khổ dọc.
**Thử không cần live:** `http://localhost:3946/?demo=1` (phím 1 chat trâu, 2 chat gà, H tim, G/5/D/K/M quà 1/5/10/30/99 xu, R vòng mới, E đóng live) hoặc `?demo=bots`.

## Luật
- Chat `trâu` / `gà` (hoặc `1` / `2`) để vào phe; chat khác hoặc thả tim thì vào phe ít người hơn. 5 phút không tim, không chat thì rời sân.
- Chat, tim, quà đều kéo dây. Càng nhiều tim gần đây thì kéo càng khoẻ. Khoảng 25–40 giây có 🥁 Trống hội 6 giây, mọi cú kéo gấp đôi.
- Quà: 1 xu 🍬, 5 xu 🍙, 10 xu 💪, 30 xu 🥁 (phe mình ×2 trong 8 giây), 99 xu ⚓ (phe kia yếu một nửa trong 8 giây).
- Khăn đỏ chạm vạch trắng thì thắng; hết 75 giây phe đang dẫn thắng. Phe thắng mỗi người +30 điểm.
- Dưới 10 người thật có 5 người chơi 🤖, không tính điểm.

## Lệnh chủ live
`tb …`, `ghim …` / `bỏ ghim`, `đọc ít/vừa/nhiều`, `tắt/bật đọc`, `đóng live`, `xoá bảng`, `đuổi/tha @tên`, `vòng mới`.

**Chủ live phải có mặt và nói chuyện**, đừng để game tự chạy.

## Trang điều khiển (10/11)
Đêm 10/11 TikTok không chuyển các tin chủ live gõ trong LIVE Studio tới game (Lớp Học), nên lệnh chat có thể không có tác dụng. Trang này bấm nút thay cho chat:
- Trên máy chạy game: `http://localhost:3946/dieu-khien.html`. Mở trong trình duyệt thường, **không** dán vào LIVE Studio.
- Trên điện thoại cùng Wi-Fi (cần `LAN=1` trong `.env`): dùng link `…/dieu-khien.html?key=…` hiện trong cửa sổ game lúc khởi động.
- Có nút cho các lệnh riêng của game, mức đọc, tắt/bật giọng, thông báo, ghim, đóng live, và một ô gõ lệnh khác (`đuổi @tên`, `xoá bảng`…).
- Game hiện thông báo trên màn hình live khi nhận lệnh. Lệnh gõ sai thì hiện "Lệnh chưa hiểu".
