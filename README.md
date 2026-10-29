# Hỗ trợ Đăng ký Môn học & Quản lý Thời khóa biểu

Ứng dụng web tĩnh (Client-side Web Application) được thiết kế hiện đại, trực quan, hỗ trợ sinh viên Trường Đại học Sài Gòn (SGU) dễ dàng nhập dữ liệu thời khóa biểu từ các file thông báo của trường, duyệt danh sách học phần, lựa chọn nhóm lớp tối ưu, kiểm tra trùng lịch tự động, lập thời khóa biểu cá nhân và in ấn trực tiếp.

---

## 📂 Cấu trúc Dự án

Dự án tuân thủ nghiêm ngặt mô hình **Single-File / Vanilla Stack** (gồm HTML, CSS và JavaScript thuần, kết hợp thư viện đọc PDF/Excel qua CDN):

*   **`index.html`**: Giao diện chính của ứng dụng. Bao gồm thanh điều hướng (topbar), khu vực kéo thả file (dropzone), không gian làm việc (workspace) chia thành tab Chọn lớp học phần và tab Dữ liệu chi tiết, cột danh sách lớp đã chọn, và bảng hiển thị thời khóa biểu cá nhân theo tuần.
*   **`styles.css`**: Hệ thống giao diện được tối ưu hóa toàn diện:
    *   Hỗ trợ **Chế độ Sáng (Light Mode)** và **Chế độ Tối (Dark Mode)** mượt mà thông qua CSS Custom Properties (`:root`).
    *   Thiết kế Responsive hoàn toàn cho cả máy tính, máy tính bảng và thiết bị di động.
    *   Tối ưu hóa giao diện trang in (Print-friendly layout) ẩn các thành phần thừa và định dạng lại bảng thời khóa biểu khi in/xuất PDF.
*   **`parser.js`**: Thư viện bóc tách và phân tích cú pháp (Parser) độc lập (không phụ thuộc DOM):
    *   **Xử lý Excel/CSV**: Đọc dữ liệu dạng ma trận từ các file bảng tính (`.xlsx`, `.xls`, `.csv`), tự động nhận diện dòng tiêu đề và ánh xạ chính xác các trường dữ liệu.
    *   **Xử lý PDF thông minh**: Phân tích cấu trúc các file thời khóa biểu PDF của SGU (như `DCT.pdf`, `TKB_monchung.pdf`) bằng cách gom nhóm các đoạn text theo vị trí tọa độ (`x`, `y`), nhận diện đường kẻ dọc (vlines) của bảng, thuật toán chia phân vùng (partition) thông minh để gộp chính xác Mã môn học, Nhóm, Giảng viên, Tiết học và Phòng học ngay cả khi dữ liệu bị ngắt trang hoặc gộp ô phức tạp.
*   **`script.js`**: Bộ não điều khiển logic ứng dụng và tương tác giao diện:
    *   Tích hợp **PDF.js** và **SheetJS (XLSX)** qua CDN để đọc file trực tiếp trên trình duyệt mà không cần qua server trung gian.
    *   Quản lý trạng thái ứng dụng (State Management) và lưu trữ tự động vào `localStorage` (`tkb2_classes`, `tkb2_selected`, `tkb2_files`, `tkb2_theme`).
    *   Xử lý logic chọn lớp, kiểm tra trùng lịch (clash detection) theo ngày và tiết học, sinh màu sắc riêng biệt cho từng môn học dựa trên mã hash.
    *   Hỗ trợ tìm kiếm thời gian thực (real-time search), sắp xếp đa tiêu chí và in ấn thời khóa biểu cá nhân.

---

## ✨ Tính năng Nổi bật

1.  **Đa dạng định dạng đầu vào**: Hỗ trợ kéo thả hoặc chọn nhiều file cùng lúc gồm file PDF lịch chuyên ngành (như `DCT.pdf`), file PDF môn chung (`TKB_monchung.pdf`), cũng như các định dạng Excel, CSV phổ biến.
2.  **Thông báo & Cảnh báo trực quan**: Hệ thống tự động kiểm tra và hiển thị trạng thái đọc file thành công kèm theo các cảnh báo (nếu có) khi phát hiện định dạng bất thường.
3.  **Kiểm tra Trùng lịch Thông minh**: Khi bạn chọn một nhóm lớp, hệ thống tự động khóa hoặc hiển thị lý do không thể chọn đối với các nhóm lớp khác bị trùng lịch hoặc cùng môn học.
4.  **Thời khóa biểu Cá nhân Trực quan**: Tự động tổng hợp thời khóa biểu theo dạng lưới tuần (Thứ 2 đến Chủ nhật, từ tiết 1 đến tiết 12+), tính toán tổng số tiết và số lượng lớp đã chọn.
5.  **Giao diện Thân thiện & In ấn Chuyên nghiệp**: Hỗ trợ chuyển đổi Dark/Light mode linh hoạt và chế độ in ấn chuẩn mực để sinh viên dễ dàng lưu trữ hoặc mang theo.

---

## 🚀 Hướng dẫn Sử dụng

1. Tải toàn bộ mã nguồn gồm `index.html`, `styles.css`, `parser.js` và `script.js` vào cùng một thư mục trên máy tính.
2. Mở file `index.html` bằng bất kỳ trình duyệt web hiện đại nào (Chrome, Firefox, Edge, Safari).
3. Kéo thả các file thời khóa biểu (ví dụ: file PDF thời khóa biểu ngành hoặc môn chung) vào vùng nhận file.
4. Chuyển sang tab **"Chọn lớp học phần"**, tìm kiếm môn học mong muốn và bấm **"Chọn"** để xếp lịch.
5. Kiểm tra thời khóa biểu cá nhân ở phần bên dưới và bấm **"In thời khóa biểu"** khi hoàn tất.
