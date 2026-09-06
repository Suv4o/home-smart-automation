import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		// `npm run dev` talks to the daemon running on 8080.
		proxy: {
			"/api": { target: "http://localhost:8080", changeOrigin: true },
		},
	},
	build: { outDir: "dist", emptyOutDir: true },
});
