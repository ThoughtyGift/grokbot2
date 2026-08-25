import { defineConfig } from "vite";

export default defineConfig({
  /*
   * Đường dẫn tài nguyên TƯƠNG ĐỐI, để một bản build chạy được ở hai gốc.
   *
   * Dev thì trang này ở `/` trên :5173. Nhưng backend cũng phát chính bản build này ở `/app/`
   * — đó là nơi app desktop được đưa tới để đăng nhập (xem `/loginDeepControl`). Với `base`
   * mặc định `/`, index.html trỏ `/assets/…`, và ở `/app/` thì hai file đó 404: trang trắng,
   * không lỗi nào nói vì sao.
   */
  base: "./",

  server: {
    /**
     * Nghe trên IPv4 loopback, không để mặc định.
     *
     * Mặc định Vite bind `localhost`, mà trên Windows `localhost` phân giải ra `::1` trước — nên
     * server chỉ nghe IPv6 và mở `http://127.0.0.1:5173` bị ERR_CONNECTION_REFUSED, trong khi
     * `http://localhost:5173` lại chạy. Cùng một trang, hai địa chỉ, một cái hỏng: đủ để tưởng là
     * app chết. Bind thẳng 127.0.0.1 thì cả hai đều vào được — trình duyệt thử `::1` hụt rồi tự
     * lùi về IPv4.
     *
     * Không dùng `host: true`: nó mở dev server ra cả mạng LAN, mà đây là công cụ chạy máy mình.
     */
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": { target: "http://127.0.0.1:8788", changeOrigin: false },
    },
  },
  preview: { port: 5173 },
});
