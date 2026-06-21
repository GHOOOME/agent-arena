import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Token Plan Arena',
  description: '阿里云 Token Plan 多模型对话与图片生成工具',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className="dark">
      <body className={`${inter.className} bg-[var(--arena-bg)] text-[var(--arena-ink)] antialiased`}>{children}</body>
    </html>
  );
}
