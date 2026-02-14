import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const src = path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const publicDir = path.join(root, "public");
const dest = path.join(publicDir, "pdf.worker.min.mjs");

try {
  if (!fs.existsSync(src)) {
    console.log("[postinstall] pdfjs worker not found at:", src);
    process.exit(0);
  }

  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  fs.copyFileSync(src, dest);
  console.log("[postinstall] Copied pdf.worker.min.mjs to public/");
  process.exit(0);
} catch (err) {
  console.log("[postinstall] Failed to copy pdfjs worker:", err?.message ?? err);
  // Do not fail install/build
  process.exit(0);
}
