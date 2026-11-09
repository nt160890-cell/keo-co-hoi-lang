# Kéo Co Hội Làng Live: thiết kế game

Game kéo co cho TikTok LIVE, chạy offline trên một máy, khung lấy từ `../dai-chien-oc-sen` (server, giọng đọc, TikTok, trang chính, demo, lệnh chủ live, bảng quà, tab đại gia). Làm ngày 08/11/2026 theo ý chủ live, sau khi tìm hiểu trend. **Chưa thử trên live thật.** Kiểu game kéo co là thể loại chung; nhân vật, hình và tên quà là của riêng game.

Người dùng nói tiếng Việt: trả lời, hiển thị và đọc bằng tiếng Việt. Code và chú thích viết bằng tiếng Anh. Đọc `../BAI-HOC-LIVE.md` trước. Hai phe là con vật, không chia theo vùng miền.

## Chạy
Cổng **3946**. `?demo=1`, `?demo=bots`. Thử trên cổng khác: `PORT=3955 TIKTOK_USERNAME= LAN=0 node server.mjs`, rồi `node tools/check.mjs "http://127.0.0.1:3955/?demo=bots&voice=0&motion=1" shot.png --wait 30000 --eval "JSON.stringify(window.keoco.round())"`.

## Luật
- Vị trí dây `pos` từ −100 (Phe Trâu thắng) đến 100 (Phe Gà thắng). `pull(side, units, …)`: mỗi đơn vị chia `crowdScale()` (càng đông càng nhỏ), ×2 khi trống hội hoặc phe được 🥁, ×0,5 khi phe bị ⚓.
- Chat `CHAT_PULL` 2, mỗi người tối đa 1 lần / giây. Tim: `HEART_PULL` 0,5 mỗi tim × (1 + `heartBoost`). Quà: `GIFT_PULLS`. Mỗi giây mọi người trên sân kéo nhẹ `AUTO_PULL`, dây trôi về giữa `CENTER_PULL`.
- Vòng `ROUND_MS` 75 giây; lệch dưới `DRAW_WITHIN` là hoà. Giữ chỗ `HOOK_KICK` 5 phút. Dưới `BOT_UNDER` người thật có `BOT_COUNT` bot 🤖, không tính điểm.
- Điểm: mỗi đơn vị kéo 1 điểm (ít nhất 1), quà `max(5, xu × 5)`, phe thắng +30. `sess.dmg` là tổng lực kéo (tab Top lực kéo).

## Tên to hơn (09/11, chủ live chọn)
- Tên trên đầu nhân vật vẽ 900 23 px, ba hàng so le cách 27 (trước quá nhỏ và mờ ở 720p).

## Làm nổi lời kêu gọi (09/11, chủ live chọn)
- Trong hộp hướng dẫn, việc người xem cần làm (Thả tim, Chat, Tặng quà) nằm trong nhãn đỏ `.cta`, chữ cần gõ (`kbd`) vàng phát sáng; cả hai nhấp nhẹ (`ctaPulse`, tắt khi `reduced`).

## Tự nối lại khi mất tín hiệu, vào xem là có chỗ (09/11, chủ live chọn, sau buổi Đào Vàng 21:57)
- Server: đang live mà `STALE_MS` 2 phút không nhận được gì từ TikTok (số người xem, chat, tim, người vào, quà) thì ngắt và nối lại, ghi nhật ký, gửi `{type:'stale'}`; trang hiện "⚠️ Mất tín hiệu TikTok, đang nối lại…" ở dòng trạng thái (vùng TikTok che, chỉ chủ live thấy) 20 giây. Buổi 09/11 21:57–22:05 game "đã nối" 8 phút mà chỉ nhận 6 sự kiện sau lỗi `DEVICE_BLOCKED`.
- Người vừa vào live vào phe ít người hơn, kéo cùng trong 1 phút (`MEMBER_PLAY`); chat / tim thì giữ 5 phút.

- **Trang điều khiển** `public/dieu-khien.html` (10/11, vì TikTok không chuyển tin chủ live gõ trong LIVE Studio): nút bấm gửi `POST /host-cmd {text}` (cùng quyền như các trang khác: máy này, hoặc khoá LAN), server gửi `{type:'hostcmd', text, demo}` tới mọi trang cùng chế độ, trang chạy `hostCommand(text)`; lệnh không hiểu thì hiện "Lệnh chưa hiểu". Link in ra lúc khởi động. Thêm lệnh chủ live mới thì thêm nút vào trang này.
